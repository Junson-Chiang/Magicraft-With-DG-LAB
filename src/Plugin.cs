using System;
using System.Collections.Generic;
using System.Reflection;
using BepInEx;
using BepInEx.Configuration;
using HarmonyLib;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace MagicraftEvents
{
    [BepInPlugin(Id, "Magicraft Event Collector", "0.5.0")]
    public sealed class Plugin : BaseUnityPlugin
    {
        public const string Id = "local.magicraft.eventcollector";
        internal static Plugin Instance;
        internal bool voluntaryExit;
        private Harmony harmony;
        private EventSink sink;
        private float nextSample;
        private float lastScale = -1;
        private ConfigEntry<float> sampleInterval;
        private bool sampleErrorReported;
        private readonly List<string> activeHooks = new List<string>();

        private void Awake()
        {
            Instance = this;
            sampleInterval = Config.Bind("Collector", "SampleIntervalSeconds", 1f, "Player snapshot interval, minimum 0.1 seconds.");
            var udp = Config.Bind("Output", "EnableUdp", true, "Send UTF-8 JSON datagrams to loopback.");
            var port = Config.Bind("Output", "UdpPort", 17891, "Local receiver port.");
            var file = Config.Bind("Output", "EnableJsonl", true, "Write one JSON event per line under BepInEx/MagicraftEvents.");
            sink = new EventSink(Paths.BepInExRootPath, udp.Value, port.Value, file.Value, message => Logger.LogWarning(message));
            harmony = new Harmony(Id);
            Hook("PlayerController", "AfterTakeDamage", "Damage", null, 1);
            Hook("RoomController", "RoomEnter", null, "RoomEnter", 0);
            Hook("RoomController", "RoomLeave", null, "RoomLeave", 0);
            Hook("RoomController", "OnRoomFinish", "BeforeRoomFinish", "RoomFinish", 1);
            Hook("BattleMgr", "Start_Normal", null, "BattleInitialized", 0);
            Hook("UIPlayerDead", "OnShow", null, "PlayerDeath", 1);
            Hook("UIMenu", "_MenuQuitYes", "VoluntaryExit", null, 0);
            Hook("UIChapterThrough", "Show", "ChapterCompleted", null, 2);
            Hook("UIBattleMgr", "PopoutCurrentFinishBuild", "Victory", null, 1);
            SceneManager.activeSceneChanged += SceneChanged;
            Emit("collector.started", new Dictionary<string, object> { { "pluginVersion", "0.5.0" }, { "gameVersion", Application.version }, { "hooks", activeHooks.ToArray() } });
            Logger.LogInfo("Event collector ready: " + activeHooks.Count + "/9 hooks. UDP 127.0.0.1:" + port.Value);
        }

        private void Hook(string type, string method, string prefix, string postfix, int argumentCount)
        {
            try
            {
                var t = AccessTools.TypeByName(type);
                MethodInfo target = null;
                if (t != null) foreach (var candidate in t.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static))
                    if (candidate.Name == method && candidate.GetParameters().Length == argumentCount) { target = candidate; break; }
                if (target == null) throw new MissingMethodException(type, method);
                harmony.Patch(target, prefix == null ? null : new HarmonyMethod(typeof(Hooks), prefix), postfix == null ? null : new HarmonyMethod(typeof(Hooks), postfix));
                activeHooks.Add(type + "." + method);
            }
            catch (Exception ex) { Logger.LogWarning("Hook unavailable: " + type + "." + method + ": " + ex.Message); }
        }

        internal void Emit(string name, Dictionary<string, object> data)
        {
            try
            {
                if (sink == null) return;
                data["scene"] = SceneManager.GetActiveScene().name;
                data["stage"] = Read(StaticInstance("BattleMgr"), "CurrentStage");
                data["level"] = Read(StaticInstance("BattleMgr"), "CurrentLevel");
                sink.Publish(name, data);
            }
            catch (Exception ex) { Logger.LogWarning("Event capture failed: " + name + ": " + ex.Message); }
        }

        private void Update()
        {
            if (lastScale != Time.timeScale)
            {
                lastScale = Time.timeScale;
                Emit("time_scale.changed", new Dictionary<string, object> { { "timeScale", lastScale } });
            }
            if (Time.unscaledTime < nextSample) return;
            nextSample = Time.unscaledTime + Math.Max(0.1f, sampleInterval.Value);
            try
            {
                var player = StaticInstance("PlayerMgr");
                if (player == null) return;
                var method = AccessTools.Method(player.GetType(), "TryGetPlayerPpt");
                if (method == null) return;
                var args = new object[] { null };
                if (!(bool)method.Invoke(player, args)) return;
                var config = Read(args[0], "unitCfg");
                Emit("player.snapshot", new Dictionary<string, object> {
                    { "hp", Read(config, "currentHP") }, { "maxHp", Read(config, "maxHP") },
                    { "shield", Read(config, "shield") }, { "temporaryShield", Read(config, "shieldTemp") },
                    { "coins", Read(player, "CoinCount") }, { "keys", Read(player, "KeyCount") }, { "timeScale", Time.timeScale }
                });
            }
            catch (Exception ex)
            {
                if (!sampleErrorReported) { sampleErrorReported = true; Logger.LogWarning("Snapshot unavailable: " + ex.Message); }
            }
        }

        private void SceneChanged(Scene before, Scene after)
        {
            Emit("scene.changed", new Dictionary<string, object> { { "from", before.name }, { "to", after.name } });
        }

        private void OnDestroy()
        {
            SceneManager.activeSceneChanged -= SceneChanged;
            if (harmony != null) harmony.UnpatchSelf();
            Emit("collector.stopped", new Dictionary<string, object>());
            if (sink != null) sink.Dispose();
            Instance = null;
        }

        internal static object StaticInstance(string type)
        {
            var t = AccessTools.TypeByName(type);
            return t == null ? null : Read(t, "Inst");
        }

        internal static object PlayerConfig()
        {
            var player = StaticInstance("PlayerMgr");
            if (player == null) return null;
            var method = AccessTools.Method(player.GetType(), "TryGetPlayerPpt");
            if (method == null) return null;
            var args = new object[] { null };
            return (bool)method.Invoke(player, args) ? Read(args[0], "unitCfg") : null;
        }

        internal static object Read(object value, string name)
        {
            if (value == null) return null;
            var type = value as Type ?? value.GetType();
            var instance = value is Type ? null : value;
            var field = type.GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static);
            if (field != null) return field.GetValue(instance);
            var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static);
            return property == null ? null : property.GetValue(instance, null);
        }

        internal static string DamageSource(object info, out string attackerUnitType)
        {
            attackerUnitType = "";
            if (Convert.ToBoolean(Read(info, "isTrapDamage"))) return "trap";
            try
            {
                var player = StaticInstance("PlayerMgr");
                var entity = Read(info, "attackerEntity");
                if (entity != null && player != null && Convert.ToInt32(Read(entity, "Index")) != 0)
                {
                    if (entity.Equals(Read(player, "PlayerEtt"))) { attackerUnitType = "Player"; return "self"; }
                    var manager = Read(player, "ettMgr");
                    var component = AccessTools.TypeByName("UnitProperty_Dots");
                    var managerType = manager.GetType();
                    MethodInfo has = null, get = null;
                    foreach (var method in managerType.GetMethods(BindingFlags.Public | BindingFlags.Instance))
                    {
                        if (!method.IsGenericMethodDefinition || method.GetGenericArguments().Length != 1 || method.GetParameters().Length != 1) continue;
                        if (method.GetParameters()[0].ParameterType != entity.GetType()) continue;
                        if (method.Name == "HasComponent") has = method;
                        if (method.Name == "GetComponentData") get = method;
                    }
                    if (component != null && has != null && get != null && (bool)has.MakeGenericMethod(component).Invoke(manager, new object[] { entity }))
                    {
                        var ppt = get.MakeGenericMethod(component).Invoke(manager, new object[] { entity });
                        attackerUnitType = Convert.ToString(Read(Read(ppt, "unitCfg"), "unitType"));
                        if (attackerUnitType == "Monster" || attackerUnitType == "Elite" || attackerUnitType == "Boss") return "enemy";
                        if (attackerUnitType == "Player" || attackerUnitType == "Teammate" || attackerUnitType == "TeammateNotAttack") return "self";
                    }
                }
            }
            catch { /* Entity may already have been destroyed; leave its source unconfirmed. */ }
            var attacker = Convert.ToString(Read(info, "attackerType"));
            return attacker == "Venom" || attacker == "Burn" ? "dot" : "unknown";
        }

        internal static Dictionary<string, object> RoomData(object room)
        {
            var cfg = Read(room, "roomCfg");
            return new Dictionary<string, object> { { "roomId", Read(cfg, "id") },
                { "roomKey", room is UnityEngine.Object ? ((UnityEngine.Object)room).GetInstanceID().ToString() : "" },
                { "roomType", Convert.ToString(Read(cfg, "type")) }, { "theme", Convert.ToString(Read(cfg, "themeType")) },
                { "hasBossFight", Read(room, "hasBossFight") } };
        }
    }

    internal static class Hooks
    {
        private static void Safe(Action action)
        {
            try { if (Plugin.Instance != null) action(); }
            catch { /* Collector failures must not interrupt game methods. */ }
        }
        public static void Damage(object[] __args)
        {
            Safe(delegate {
                var info = __args[0];
                if (Convert.ToString(Plugin.Read(info, "attackerType")) == "FromUI") {
                    Plugin.Instance.voluntaryExit = true;
                    Plugin.Instance.Emit("battle.exited", new Dictionary<string, object> { { "reason", "menu" } });
                    return;
                }
                if (Plugin.Instance.voluntaryExit) return;
                var real = Convert.ToSingle(Plugin.Read(info, "realDamage"));
                if (Convert.ToBoolean(Plugin.Read(info, "immuneDamage")) || real <= 0) return;
                var config = Plugin.PlayerConfig();
                string attackerUnitType;
                var damageSource = Plugin.DamageSource(info, out attackerUnitType);
                Plugin.Instance.Emit("player.damaged", new Dictionary<string, object> {
                    { "realDamage", real }, { "rawDamage", Plugin.Read(info, "damage") },
                    { "hpDamage", Math.Max(0f, Convert.ToSingle(Plugin.Read(info, "damage"))) },
                    { "maxHp", Plugin.Read(config, "maxHP") }, { "hpAfter", Plugin.Read(config, "currentHP") },
                    { "damageType", damageSource }, { "attackerUnitType", attackerUnitType },
                    { "attackerType", Convert.ToString(Plugin.Read(info, "attackerType")) },
                    { "magicShieldDamage", Plugin.Read(info, "hitMagicShieldDamage") },
                    { "isTrap", Plugin.Read(info, "isTrapDamage") }, { "critical", Plugin.Read(info, "isDamageCritical") }
                });
            });
        }
        public static void RoomEnter(object __instance) { Safe(() => Plugin.Instance.Emit("room.entered", Plugin.RoomData(__instance))); }
        public static void RoomLeave(object __instance) { Safe(() => Plugin.Instance.Emit("room.left", Plugin.RoomData(__instance))); }
        public static void BeforeRoomFinish(object __instance, out bool __state)
        {
            __state = true;
            try { __state = Convert.ToBoolean(Plugin.Read(__instance, "IsFinish")); } catch { }
        }
        public static void RoomFinish(object __instance, bool __state)
        {
            Safe(delegate { if (!__state && Convert.ToBoolean(Plugin.Read(__instance, "IsFinish"))) Plugin.Instance.Emit("room.completed", Plugin.RoomData(__instance)); });
        }
        public static void BattleInitialized() { Safe(delegate { Plugin.Instance.voluntaryExit = false; Plugin.Instance.Emit("battle.initialized", new Dictionary<string, object>()); }); }
        public static void VoluntaryExit(object __instance) { Safe(delegate {
            if (SceneManager.GetActiveScene().name != "Battle" || !Convert.ToBoolean(Plugin.Read(Plugin.Read(__instance, "canvasConfirm"), "interactable"))) return;
            Plugin.Instance.voluntaryExit = true;
            Plugin.Instance.Emit("battle.exited", new Dictionary<string, object> { { "reason", "menu" } });
        }); }
        public static void PlayerDeath() { Safe(delegate {
            if (Plugin.Instance.voluntaryExit) return;
            Plugin.Instance.Emit("player.died", new Dictionary<string, object> { { "confirmedDeath", true } });
        }); }
        public static void ChapterCompleted(object[] __args) { Safe(delegate {
            if (Plugin.Instance.voluntaryExit || SceneManager.GetActiveScene().name != "Battle") return;
            Plugin.Instance.Emit("chapter.completed", new Dictionary<string, object> { { "chapter", __args[0] } });
        }); }
        public static void Victory() { Safe(delegate {
            if (Plugin.Instance.voluntaryExit || SceneManager.GetActiveScene().name != "Battle") return;
            var hp = Plugin.Read(Plugin.PlayerConfig(), "currentHP");
            if (hp == null || Convert.ToSingle(hp) <= 0) return;
            Plugin.Instance.Emit("battle.victory", new Dictionary<string, object> { { "confirmedVictory", true } });
        }); }
    }
}
