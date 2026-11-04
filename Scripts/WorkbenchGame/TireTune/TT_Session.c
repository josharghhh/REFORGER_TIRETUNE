// TireTune session export: everything the UI server needs to tune one vehicle prefab, written as JSON.
//  - "files": the text of the prefab, its parent prefabs and every .conf they reference (with their parents).
//    Packed / vanilla files are read through the Workbench file system and embedded; files in the creator's
//    unpacked addons are only listed with their absolute path (the server reads and writes those on disk).
//  - "wb": Workbench-resolved values (BaseContainer API: inheritance and engine defaults applied) for every
//    tunable field, flattened to keys like "axle0.Tyre.LateralFriction". The UI compares them with its own text
//    resolution and uses them for values the prefab leaves at engine defaults.
class TT_Session
{
	protected ref array<string> m_aIds = {};
	protected ref array<string> m_aRoots = {};
	protected ref map<string, bool> m_Seen = new map<string, bool>();
	protected ref array<string> m_aQueue = {};
	protected ref FileHandle m_File; //!< must be ref: a plain member is weak and the handle dies after one WriteLine
	protected bool m_bFirst;
	int m_iFiles;
	int m_iMissing;

	protected ref array<ResourceName> m_aFound = {};

	//! Tyre-model configs the UI offers as comparison presets: every .conf with "Pacejka" in its name in the loaded
	//! game data and addons (paths differ between builds, so they are searched, not hard-coded).
	void Presets(notnull array<string> list)
	{
		m_aFound.Clear();
		array<string> ext = {"conf"};
		array<string> words = {"Pacejka"};
		Workbench.SearchResources(m_aFound.Insert, ext, words);
		foreach (ResourceName rn : m_aFound)
		{
			string path = rn.GetPath();
			if (path.Contains("Pacejka") && list.Count() < 40)
				list.Insert(path);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! Writes the session for prefab to outAbs. Returns false with error set when it cannot.
	bool Write(ResourceName prefab, string outAbs, out string error)
	{
		Resource res = BaseContainerTools.LoadContainer(prefab);
		if (!res || !res.IsValid())
		{
			error = "Cannot load " + prefab;
			return false;
		}
		IEntitySource src = res.GetResource().ToEntitySource();
		IEntityComponentSource sim = FindComponent(src, "VehicleWheeledSimulation");
		if (!sim)
		{
			error = prefab.GetPath() + " has no VehicleWheeledSimulation: select a wheeled vehicle prefab.";
			return false;
		}
		TT_Addons.Writable(m_aIds, m_aRoots);

		m_File = FileIO.OpenFile(outAbs, FileMode.WRITE);
		if (!m_File)
		{
			error = "Cannot write " + outAbs;
			return false;
		}
		m_File.WriteLine("{");
		m_File.WriteLine(" \"version\": 1,");
		m_File.WriteLine(" \"source\": \"workbench\",");
		m_File.WriteLine(" \"prefab\": " + Q(prefab) + ",");
		m_File.WriteLine(" \"addons\": [");
		for (int i = 0; i < m_aIds.Count(); i++)
		{
			string sep = ",";
			if (i == m_aIds.Count() - 1)
				sep = "";
			m_File.WriteLine("  {\"id\": " + Q(m_aIds[i]) + ", \"root\": " + Q(m_aRoots[i]) + "}" + sep);
		}
		m_File.WriteLine(" ],");

		// files: the prefab chain and every config it references
		m_File.WriteLine(" \"files\": {");
		m_bFirst = true;
		Enqueue(prefab.GetPath());
		array<string> presets = {};
		Presets(presets);
		foreach (string preset : presets)
			Enqueue(preset);
		while (!m_aQueue.IsEmpty())
		{
			string path = m_aQueue[0];
			m_aQueue.RemoveOrdered(0);
			AddFile(path);
		}
		m_File.WriteLine(" },");
		m_File.WriteLine(" \"presets\": [");
		for (int p = 0; p < presets.Count(); p++)
		{
			string psep = ",";
			if (p == presets.Count() - 1)
				psep = "";
			m_File.WriteLine("  " + Q(presets[p]) + psep);
		}
		m_File.WriteLine(" ],");

		// Workbench-resolved values
		m_File.WriteLine(" \"wb\": {");
		m_bFirst = true;
		IEntityComponentSource rigid = FindComponent(src, "RigidBody");
		if (rigid)
			DumpVars(rigid, "rigidBody.");
		BaseContainer simulation = sim.GetObject("Simulation");
		if (simulation)
		{
			DumpVars(simulation, "sim.");
			array<string> parts = {"Suspension", "Wheel", "Tyre", "Steering", "Swaybar"};
			BaseContainerList axles = simulation.GetObjectArray("Axles");
			for (int a = 0; axles && a < axles.Count(); a++)
			{
				BaseContainer axle = axles.Get(a);
				string pre = "axle" + a.ToString() + ".";
				Str(pre + "id", axle.GetName());
				DumpVars(axle, pre);
				foreach (string part : parts)
				{
					BaseContainer obj = axle.GetObject(part);
					if (obj)
						DumpVars(obj, pre + part + ".");
				}
			}
			BaseContainer tyre = simulation.GetObject("TyreModel");
			if (tyre)
			{
				Str("tyre.class", tyre.GetClassName());
				DumpVars(tyre, "tyre.");
				array<string> groups = {"Longitudinal", "Lateral", "CombinedLongitudinal", "CombinedLateral", "Aligning"};
				foreach (string group : groups)
				{
					BaseContainer g = tyre.GetObject(group);
					if (g)
						DumpVars(g, "tyre." + group + ".");
				}
			}
		}
		m_File.WriteLine(" }");
		m_File.WriteLine("}");
		m_File.Close();
		return true;
	}

	//------------------------------------------------------------------------------------------------
	protected static IEntityComponentSource FindComponent(IEntitySource src, string className)
	{
		for (int i = 0; i < src.GetComponentCount(); i++)
		{
			IEntityComponentSource c = src.GetComponent(i);
			if (c.GetClassName() == className)
				return c;
		}
		// subclasses (e.g. a scripted VehicleWheeledSimulation_SA_B)
		for (int j = 0; j < src.GetComponentCount(); j++)
		{
			IEntityComponentSource c2 = src.GetComponent(j);
			if (c2.GetClassName().Contains(className))
				return c2;
		}
		return null;
	}

	protected void Enqueue(string path)
	{
		if (path.IsEmpty() || m_Seen.Contains(path))
			return;
		m_Seen.Insert(path, true);
		m_aQueue.Insert(path);
	}

	//! One "files" entry. Files in the creator's unpacked addons: absolute path only; others: their text.
	protected void AddFile(string path)
	{
		string abs;
		bool onDisk = Workbench.GetAbsolutePath(path, abs, true);
		bool writable;
		if (onDisk)
			writable = TT_Addons.IsUnder(abs, m_aRoots);
		string text;
		bool read = ReadText(path, abs, onDisk, text);
		if (!read)
		{
			m_iMissing++;
			Print("[TireTune] cannot read " + path, LogLevel.WARNING);
			return;
		}
		m_iFiles++;
		ScanRefs(text, path.EndsWith(".et"));
		string entry = Q(path) + ": {\"writable\": " + Bool(writable);
		if (onDisk)
			entry += ", \"abs\": " + Q(abs);
		if (!writable)
			entry += ", \"text\": " + Q(text);
		Line(entry + "}");
	}

	protected static bool ReadText(string path, string abs, bool onDisk, out string text)
	{
		FileHandle fh;
		if (onDisk)
			fh = FileIO.OpenFile(abs, FileMode.READ);
		if (!fh)
			fh = FileIO.OpenFile(path, FileMode.READ);
		if (!fh)
			fh = FileIO.OpenFile("$ArmaReforger:" + path, FileMode.READ);
		if (!fh)
			return false;
		string line;
		bool first = true;
		while (fh.ReadLine(line) >= 0)
		{
			if (!first)
				text += "\n";
			text += line;
			first = false;
		}
		fh.Close();
		return true;
	}

	//! Follows "{GUID}path.conf" references anywhere, and the root ancestor of a prefab (first object line).
	protected void ScanRefs(string text, bool isPrefab)
	{
		int pos = 0;
		int firstBrace = text.IndexOf("{\n");
		while (true)
		{
			int start = text.IndexOfFrom(pos, "\"{");
			if (start < 0)
				break;
			int end = text.IndexOfFrom(start + 2, "\"");
			if (end < 0)
				break;
			string quoted = text.Substring(start + 1, end - start - 1);
			pos = end + 1;
			int close = quoted.IndexOf("}");
			if (close < 0)
				continue;
			string refPath = quoted.Substring(close + 1, quoted.Length() - close - 1);
			if (refPath.EndsWith(".conf"))
				Enqueue(refPath);
			else if (isPrefab && refPath.EndsWith(".et") && (firstBrace < 0 || start < firstBrace))
				Enqueue(refPath);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! Every scalar / int / bool / vector variable of one object, flattened under prefix.
	protected void DumpVars(BaseContainer c, string prefix)
	{
		for (int i = 0; i < c.GetNumVars(); i++)
		{
			string name = c.GetVarName(i);
			DataVarType t = c.GetDataVarType(i);
			if (t == DataVarType.SCALAR)
			{
				float f;
				if (c.Get(name, f))
					Raw(prefix + name, f.ToString(-1, 6));
			}
			else if (t == DataVarType.INTEGER || t == DataVarType.FLAGS)
			{
				int n;
				if (c.Get(name, n))
					Raw(prefix + name, n.ToString());
			}
			else if (t == DataVarType.BOOLEAN)
			{
				bool b;
				if (c.Get(name, b))
				{
					if (b)
						Raw(prefix + name, "1");
					else
						Raw(prefix + name, "0");
				}
			}
			else if (t == DataVarType.VECTOR3)
			{
				vector v;
				if (c.Get(name, v))
					Raw(prefix + name, "[" + v[0].ToString(-1, 6) + ", " + v[1].ToString(-1, 6) + ", " + v[2].ToString(-1, 6) + "]");
			}
		}
	}

	protected void Raw(string key, string json)
	{
		Line(Q(key) + ": " + json);
	}

	//! One member of the open JSON object; separators lead the line (FileHandle only writes whole lines).
	protected void Line(string member)
	{
		if (m_bFirst)
			m_File.WriteLine("  " + member);
		else
			m_File.WriteLine(" ," + member);
		m_bFirst = false;
	}

	protected static string Bool(bool b)
	{
		if (b)
			return "true";
		return "false";
	}

	protected void Str(string key, string value)
	{
		Raw(key, Q(value));
	}

	//! JSON string literal.
	static string Q(string s)
	{
		string e = s;
		e.Replace("\\", "\\\\");
		e.Replace("\"", "\\\"");
		e.Replace("\r", "");
		e.Replace("\n", "\\n");
		e.Replace("\t", "\\t");
		return "\"" + e + "\"";
	}
}

//! The loaded addons a creator can write to: not vanilla, not packed (a Workshop download has data.pak).
class TT_Addons
{
	static void Writable(notnull array<string> ids, notnull array<string> roots)
	{
		array<string> guids = {};
		GameProject.GetLoadedAddons(guids);
		foreach (string guid : guids)
		{
			if (GameProject.IsVanillaAddon(guid))
				continue;
			string id = GameProject.GetAddonID(guid);
			string abs;
			if (id.IsEmpty() || !Workbench.GetAbsolutePath("$" + id + ":", abs, true) || abs.IsEmpty())
				continue;
			abs.Replace("\\", "/");
			while (abs.EndsWith("/"))
				abs = abs.Substring(0, abs.Length() - 1);
			if (FileIO.FileExists(abs + "/data.pak"))
				continue;
			ids.Insert(id);
			roots.Insert(abs);
		}
	}

	static bool IsUnder(string abs, notnull array<string> roots)
	{
		string f = abs;
		f.Replace("\\", "/");
		f.ToLower();
		foreach (string r : roots)
		{
			string root = r;
			root.ToLower();
			if (f.StartsWith(root + "/"))
				return true;
		}
		return false;
	}
}
