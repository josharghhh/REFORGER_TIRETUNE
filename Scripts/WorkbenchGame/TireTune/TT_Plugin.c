// TireTune: tyre (Pacejka2002) and chassis tuning for wheeled vehicle prefabs, in a UI window next to Workbench.
//  - Select a vehicle .et in the Resource Browser (or right-click it > TireTune), or pick it in the plugin settings.
//  - "Open selected vehicle" writes ui/state/session.json (TT_Session) and starts ui/serve.py --app; a running UI
//    picks the new session up by itself.
//  - The UI writes the prefab / owned configs as text and asks Workbench over the Net API (TT_NetApi) to register
//    and reload them. Without the Net API, "Reimport changes" here does the same from ui/state/pending.json.
// Python: the "Python 3 executable" setting, else python, py -3, python3: the first that runs Python 3.11+.
[WorkbenchPluginAttribute(name: "TireTune", description: "Tune tyres (Pacejka2002) and chassis of a wheeled vehicle prefab with live preview", wbModules: {"ResourceManager"}, category: "TireTune", resourceTypes: {"et"}, awesomeFontCode: 0xF1B9)]
class TT_Plugin : ResourceManagerPlugin
{
	static const string TOOL_ADDON = "TireTune_Workbench"; //!< this addon's ID

	[Attribute("", UIWidgets.ResourcePickerThumbnail, "Vehicle prefab to tune when nothing is selected in the Resource Browser", "et", category: "Vehicle")]
	ResourceName m_Vehicle;

	[Attribute("", UIWidgets.EditBox, "Python 3.11+ executable (empty = find python / py -3 automatically)", category: "Launcher")]
	string m_sPython;

	[Attribute("8790", UIWidgets.EditBox, "Local port of the TireTune UI server", category: "Launcher")]
	int m_iPort;

	protected static string s_sPython;

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		string text = "Tune the tyres and chassis of a wheeled vehicle prefab.\n\nSelect your vehicle .et in the Resource Browser (or set it in Settings), then Open selected vehicle.\nVanilla prefabs open read only: right-click > Create Inherited Prefab into your addon and tune that.";
		int pending = TT_Reimport.PendingCount(PendingPath());
		if (pending > 0)
			text += string.Format("\n\n%1 file(s) written by the UI are waiting: press Reimport changes.", pending);
		Workbench.ScriptDialog("TireTune", text, this);
	}

	override void Configure()
	{
		Workbench.ScriptDialog("TireTune settings", "", this);
	}

	override void OnResourceContextMenu(notnull array<ResourceName> resources)
	{
		foreach (ResourceName rn : resources)
		{
			if (rn.GetPath().EndsWith(".et"))
			{
				OpenVehicle(rn);
				return;
			}
		}
		Workbench.Dialog("TireTune", "Select a vehicle prefab (.et).");
	}

	[ButtonAttribute("Open selected vehicle")]
	void DoOpen()
	{
		ResourceName rn = SelectedPrefab();
		if (rn.IsEmpty())
		{
			Workbench.Dialog("TireTune", "Select a vehicle prefab (.et) in the Resource Browser, or set one in Plugins > Settings > TireTune.");
			return;
		}
		OpenVehicle(rn);
	}

	[ButtonAttribute("Open UI")]
	void DoOpenUi()
	{
		Launch();
	}

	[ButtonAttribute("Reimport changes")]
	void DoReimport()
	{
		string report;
		int n = TT_Reimport.FromFile(PendingPath(), report);
		if (n < 0)
			Workbench.Dialog("TireTune", "Nothing waiting. Apply changes from the UI first.");
		else
			Workbench.Dialog("TireTune", string.Format("Registered / reloaded %1 file(s). Reopen the world to drive the changed prefab (Reload Scripts is not enough).", n), report);
	}

	[ButtonAttribute("Close")]
	bool DoClose()
	{
		return false;
	}

	//------------------------------------------------------------------------------------------------
	protected ResourceName SelectedPrefab()
	{
		ResourceManager rm = Workbench.GetModule(ResourceManager);
		if (rm)
		{
			array<ResourceName> sel = {};
			rm.GetResourceBrowserSelection(sel.Insert, false);
			foreach (ResourceName rn : sel)
			{
				if (rn.GetPath().EndsWith(".et"))
					return rn;
			}
		}
		return m_Vehicle;
	}

	protected void OpenVehicle(ResourceName rn)
	{
		string session = StatePath("session.json");
		if (session.IsEmpty())
		{
			Workbench.Dialog("TireTune", "The TireTune_Workbench addon folder was not found (is the addon loaded with your project?).");
			return;
		}
		TT_Session s = new TT_Session();
		string error;
		if (!s.Write(rn, session, error))
		{
			Workbench.Dialog("TireTune", error);
			return;
		}
		PrintFormat("[TireTune] session %1: %2 file(s), %3 unreadable -> %4", rn.GetPath(), s.m_iFiles, s.m_iMissing, session);
		Launch();
	}

	//! <tool>/ui/state/<name>, creating the folder; "" when the tool addon is not found.
	protected static string StatePath(string name)
	{
		string ui;
		if (!Workbench.GetAbsolutePath("$" + TOOL_ADDON + ":ui", ui, true))
			return string.Empty;
		ui.Replace("\\", "/");
		string dir = ui + "/state";
		if (!FileIO.FileExists(dir))
			FileIO.MakeDirectory(dir);
		return dir + "/" + name;
	}

	protected static string PendingPath()
	{
		return StatePath("pending.json");
	}

	//------------------------------------------------------------------------------------------------
	protected string ResolvePython()
	{
		if (!s_sPython.IsEmpty())
			return s_sPython;
		array<string> cands = {};
		if (!m_sPython.IsEmpty())
			cands.Insert(m_sPython);
		cands.Insert("python");
		cands.Insert("py -3");
		cands.Insert("python3");
		foreach (string c : cands)
		{
			if (Workbench.RunCmd(c + " -c \"import sys; sys.exit(0 if sys.version_info >= (3, 11) else 3)\"", true) == 0)
			{
				s_sPython = c;
				return c;
			}
		}
		return string.Empty;
	}

	protected void Launch()
	{
		string script;
		if (!Workbench.GetAbsolutePath("$" + TOOL_ADDON + ":ui/serve.py", script, true))
		{
			Workbench.Dialog("TireTune", "ui/serve.py not found in the TireTune_Workbench addon.");
			return;
		}
		string py = ResolvePython();
		if (py.IsEmpty())
		{
			Workbench.Dialog("TireTune", "Python 3.11 or newer was not found.\n\nInstall it from python.org (tick \"Add python.exe to PATH\"), or set the Python executable in Plugins > Settings > TireTune.");
			return;
		}
		int port = m_iPort;
		if (port <= 0)
			port = 8790;
		string cmd = py + " -I \"" + script + "\" --app --port " + port.ToString() + " --session \"" + StatePath("session.json") + "\"";
		ProcessHandle h = Workbench.RunProcess(cmd);
		if (!h)
			Workbench.Dialog("TireTune", "Could not start: " + cmd);
		else
			Print("[TireTune] " + cmd);
	}

	//! Headless check: tools/wb_batch.ps1 style -plugin=TT_Plugin -ttPrefab="{GUID}Prefabs/...et" writes the session
	//! and prints a summary without starting the UI.
	override void RunCommandline()
	{
		string prefab;
		ResourceManager rm = Workbench.GetModule(ResourceManager);
		if (rm)
			rm.GetCmdLine("-ttPrefab", prefab);
		ResourceName rn = prefab;
		string session = StatePath("session.json");
		TT_Session s = new TT_Session();
		string error;
		if (rn.IsEmpty() || session.IsEmpty() || !s.Write(rn, session, error))
			Print("[TireTune] session failed: " + error, LogLevel.ERROR);
		else
			PrintFormat("[TireTune] session ok: %1 file(s), %2 unreadable -> %3", s.m_iFiles, s.m_iMissing, session);
		Workbench.Exit(0);
	}
}

//! Registers new files and reloads changed ones (from the UI's pending.json or a Net API request).
class TT_Reimport
{
	//! created: new files (register + build), changed: edited text resources (rebuild).
	static int Run(notnull array<string> created, notnull array<string> changed, out string report)
	{
		ResourceManager rm = Workbench.GetModule(ResourceManager);
		if (!rm)
		{
			report = "Resource Manager is not available.";
			return 0;
		}
		array<string> ids = {};
		array<string> roots = {};
		TT_Addons.Writable(ids, roots);
		int n;
		foreach (string abs : created)
		{
			if (!TT_Addons.IsUnder(abs, roots))
			{
				report += "refused (not in your addons): " + abs + "\n";
				continue;
			}
			if (rm.RegisterResourceFile(abs, true))
			{
				n++;
				report += "registered " + abs + "\n";
			}
			else
				report += "register failed: " + abs + "\n";
		}
		foreach (string path : changed)
		{
			if (!TT_Addons.IsUnder(path, roots))
			{
				report += "refused (not in your addons): " + path + "\n";
				continue;
			}
			rm.RebuildResourceFile(path, "PC", false);
			n++;
			report += "reloaded " + path + "\n";
		}
		return n;
	}

	//! pending.json as the UI server writes it ({"changed": [..], "created": [..]}). -1 when there is none.
	static int FromFile(string path, out string report)
	{
		array<string> created = {};
		array<string> changed = {};
		if (!Read(path, created, changed))
			return -1;
		int n = Run(created, changed, report);
		FileIO.DeleteFile(path);
		return n;
	}

	static int PendingCount(string path)
	{
		array<string> created = {};
		array<string> changed = {};
		if (!Read(path, created, changed))
			return 0;
		return created.Count() + changed.Count();
	}

	//! Minimal reader for the server's indented pending.json: one quoted path per line inside each list.
	protected static bool Read(string path, notnull array<string> created, notnull array<string> changed)
	{
		if (path.IsEmpty() || !FileIO.FileExists(path))
			return false;
		FileHandle fh = FileIO.OpenFile(path, FileMode.READ);
		if (!fh)
			return false;
		string line;
		int list; // 1 changed, 2 created
		while (fh.ReadLine(line) >= 0)
		{
			string t = line.Trim();
			if (t.StartsWith("\"changed\""))
				list = 1;
			else if (t.StartsWith("\"created\""))
				list = 2;
			else if (t.StartsWith("\"") && list > 0)
			{
				int end = t.LastIndexOf("\"");
				if (end <= 0)
					continue;
				string p = t.Substring(1, end - 1);
				p.Replace("\\\\", "/");
				if (list == 1)
					changed.Insert(p);
				else
					created.Insert(p);
			}
		}
		fh.Close();
		return true;
	}
}
