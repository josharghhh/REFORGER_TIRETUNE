// TireTune Net API handler (APIFunc "TT_NetApi"; Workbench Options > Net API must be enabled).
//  op "reimport":  register `created` files and reload `changed` ones (only inside the creator's own addons).
//  op "geometry":  wheel positions of the vehicle being tuned, from its VehicleWheeledSimulation. Uses the player's
//                  vehicle in Play mode, else the World Editor selection, else a placed instance of `prefab`.
//  op "telemetry": live wheel state of the player's vehicle in Play mode (contact, compression, slips, speed).
// Read-only except "reimport"; no script execution, no world edits.
class TT_NetApiRequest : JsonApiStruct
{
	string op;
	string prefab;
	ref array<string> changed = {};
	ref array<string> created = {};

	void TT_NetApiRequest()
	{
		RegV("op");
		RegV("prefab");
		RegV("changed");
		RegV("created");
	}
}

class TT_NetApiWheel
{
	string m_sName;
	vector m_vPos;
	vector m_vContact;
	float m_fRadius;
	bool m_bContact;
	float m_fCompression;
	float m_fLatSlip;
	float m_fLonSlip;
	float m_fRpm;
}

class TT_NetApiResponse : JsonApiStruct
{
	string status;
	string message;
	string entity;
	float speed;
	float lateral;
	float steering;
	ref array<string> results = {};
	ref array<ref TT_NetApiWheel> m_aWheels = {};

	void TT_NetApiResponse()
	{
		RegV("status");
		RegV("message");
		RegV("entity");
		RegV("speed");
		RegV("lateral");
		RegV("steering");
		RegV("results");
	}

	override void OnPack()
	{
		StartArray("wheels");
		foreach (TT_NetApiWheel w : m_aWheels)
		{
			StartObject("");
			StoreString("name", w.m_sName);
			StoreVector("pos", w.m_vPos);
			StoreVector("contactPos", w.m_vContact);
			StoreFloat("radius", w.m_fRadius);
			StoreBoolean("contact", w.m_bContact);
			StoreFloat("compression", w.m_fCompression);
			StoreFloat("latSlip", w.m_fLatSlip);
			StoreFloat("lonSlip", w.m_fLonSlip);
			StoreFloat("rpm", w.m_fRpm);
			EndObject();
		}
		EndArray();
	}
}

class TT_NetApi : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new TT_NetApiRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		TT_NetApiRequest req = TT_NetApiRequest.Cast(request);
		TT_NetApiResponse res = new TT_NetApiResponse();
		res.status = "OK";
		if (req.op == "reimport")
		{
			string report;
			int n = TT_Reimport.Run(req.created, req.changed, report);
			res.message = string.Format("%1 file(s) registered / reloaded", n);
			array<string> lines = {};
			report.Split("\n", lines, true);
			res.results.InsertAll(lines);
			return res;
		}
		if (req.op == "geometry" || req.op == "telemetry")
		{
			string how;
			IEntity vehicle = FindVehicle(req.prefab, req.op == "telemetry", how);
			if (!vehicle)
			{
				res.status = "NoVehicle";
				if (req.op == "telemetry")
					res.message = "Drive the vehicle in Play mode (World Editor) to stream telemetry.";
				else
					res.message = "Place the vehicle in the open world (or select it), or drive it in Play mode, then capture again.";
				return res;
			}
			res.entity = how;
			Fill(vehicle, res);
			return res;
		}
		res.status = "Error";
		res.message = "Unknown op " + req.op + " (reimport, geometry, telemetry)";
		return res;
	}

	//------------------------------------------------------------------------------------------------
	protected static VehicleWheeledSimulation Sim(IEntity e)
	{
		if (!e)
			return null;
		return VehicleWheeledSimulation.Cast(e.FindComponent(VehicleWheeledSimulation));
	}

	protected static IEntity FindVehicle(string prefab, bool liveOnly, out string how)
	{
		WorldEditor we = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api;
		if (we)
			api = we.GetApi();
		if (api && api.IsGameMode())
		{
			IEntity player = SCR_PlayerController.GetLocalControlledEntity();
			if (player)
			{
				SCR_CompartmentAccessComponent cac = SCR_CompartmentAccessComponent.Cast(player.FindComponent(SCR_CompartmentAccessComponent));
				if (cac)
				{
					IEntity v = cac.GetVehicle();
					if (Sim(v))
					{
						how = "player vehicle (Play mode)";
						return v;
					}
				}
			}
		}
		if (liveOnly || !api)
			return null;
		IEntitySource sel = api.GetSelectedEntity(0);
		if (sel)
		{
			IEntity e = api.SourceToEntity(sel);
			if (Sim(e))
			{
				how = "selected entity";
				return e;
			}
		}
		for (int i = 0; i < api.GetEditorEntityCount(); i++)
		{
			IEntitySource s = api.GetEditorEntity(i);
			if (!s)
				continue;
			BaseContainer anc = s.GetAncestor();
			if (!anc || anc.GetResourceName().GetPath() != prefab)
				continue;
			IEntity e2 = api.SourceToEntity(s);
			if (Sim(e2))
			{
				how = "placed instance of " + prefab;
				return e2;
			}
		}
		return null;
	}

	protected static void Fill(IEntity vehicle, TT_NetApiResponse res)
	{
		VehicleWheeledSimulation sim = Sim(vehicle);
		for (int i = 0; i < sim.WheelCount(); i++)
		{
			TT_NetApiWheel w = new TT_NetApiWheel();
			w.m_sName = sim.WheelGetName(i);
			w.m_vPos = sim.WheelGetPosition(i, 0);
			w.m_fRadius = sim.WheelGetRadius(i);
			w.m_bContact = sim.WheelHasContact(i);
			if (w.m_bContact)
			{
				w.m_vContact = vehicle.CoordToLocal(sim.WheelGetContactPosition(i));
				// hub height above its fully extended position = suspension compression
				w.m_fCompression = w.m_vContact[1] + w.m_fRadius - w.m_vPos[1];
			}
			w.m_fLatSlip = sim.WheelGetLateralSlip(i);
			w.m_fLonSlip = sim.WheelGetLongitudinalSlip(i);
			w.m_fRpm = sim.WheelGetRPM(i);
			res.m_aWheels.Insert(w);
		}
		res.steering = sim.GetSteering();
		Physics phys = vehicle.GetPhysics();
		if (phys)
		{
			vector local = vehicle.VectorToLocal(phys.GetVelocity());
			res.speed = local[2];
			res.lateral = -local[0];
		}
	}
}
