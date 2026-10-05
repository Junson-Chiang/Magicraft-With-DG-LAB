# Magicraft × DG-LAB 联动

基于当前 `E:\SteamLibrary\steamapps\common\Magicraft` 的 Unity Mono 程序集分析制作。
使用 BepInEx 5.4.23.5 x64 和 Harmony。插件仅采集游戏事件，不控制 DG-LAB 设备。
本地 Node.js 联动程序接收插件事件，通过 DG-LAB V4 SDK 控制选定设备。

## A / B 通道伤害分流（0.3.0）

两个通道分别勾选要响应的来源：敌人攻击、陷阱、自己/友方、中毒/灼烧（来源不明）、其他/来源不明。
默认 A 响应敌人攻击，B 响应陷阱。可以让两个通道响应同一种伤害，也可以关闭任一通道。
强度范围、持续时间、触发间隔及死亡反馈分别设置；A/B 任务和冷却独立，互不覆盖。
一键“敌人 → A，陷阱 → B”只改变伤害勾选，不提高强度。
旧配置迁移时保留原通道的强度范围，另一通道最高强度设为 0，需要用户手动填写。

采集优先读取 isTrapDamage；非陷阱通过 attackerEntity 查单位类型，Monster/Elite/Boss 为敌人，
Player/Teammate/TeammateNotAttack 为自己/友方。法术构造受击数据时，attackerEntity 是 OwnerEntity。
无法查询攻击者时，中毒/灼烧单独归类，其他保留未知，不把非陷阱伤害一概视为敌人。
攻击者销毁、环境伤害等可能无法确认来源，面板“最近一次受伤”可用于实测核对。
插件新增 damageType、attackerUnitType、attackerType；需要重启游戏加载更新。

页面将“满强度伤害比例”改为“扣多少血达到最高强度”，时间统一显示为秒，
“保存设置（需重新开始）”下方解释归零和重新启用步骤。设备状态显示手机 APP 是否暂停通道输出。
“停止输出并归零”同时清理 A/B 两个通道。软件不会主动解除手机 APP 的通道静音。

## 启动联动

```powershell
.\start-bridge.ps1
```

需要 Node.js 22+。首次恢复源码项目时，在 bridge 中执行 `npm ci` 安装锁定依赖。
打开终端输出的完整控制面板地址（带 `#` 后的访问令牌）。面板只监听本机 `127.0.0.1:17892`。

1. 点击“连接 / 重新配对”，使用 DG-LAB 4 APP 扫描面板二维码。
2. 在 APP 中连接并暴露设备，在面板选择郊狼 V2/V3 设备。
3. 设置最低/最高强度并保存（默认都为 0），选择 A/B 通道后重新选择设备。
4. 启动游戏，进入活动战斗，收到玩家快照后点击“启用联动”。
5. 随时点击“停止并归零”；退出联动程序时也会尝试清理任务和归零。

默认中继为 SDK 文档中的 `wss://trex.dungeon-lab.cn/v4`。可以在面板换成自建 V4 中继，
保存后点击重新配对。联动程序不会自行部署中继服务器。
运行联动时不要同时启动 `listen.ps1`，两者使用相同 UDP 接收端口。

## 联动规则

伤害比例 = hpDamage / maxHp；强度按最低/最高强度线性映射。
默认达到最大生命值 20% 的单次伤害时使用最高强度，正常反馈固定 1000ms。
默认 500ms 冷却；反馈期间只接受更高强度，替换任务时保留原结束时间。
护盾吸收部分不触发反馈。死亡使用最高强度反馈 3000ms，然后关闭联动。
房间完成、离开房间、暂停立即清理并归零；恢复后只处理新事件。
离开 Battle 场景、APP 断开、事件序号缺口、新采集会话、玩家快照超过 5 秒未更新会关闭联动。
重连后需要手动重新启用。第一版波形固定使用 SDK 的郊狼 BUBBLE，仅支持 COYOTE_020 / COYOTE_030。

V4 的 device.op 响应在任务结束时才返回；程序同时下发波形和临时强度，单独观察完成响应。
停止不会等待反馈时长，但清理/归零的网络请求仍受链路延迟影响。断网时无法保证远程归零；
所有强度反馈使用 APP 自动到期归零的临时任务，最长 3 秒。
未进行真实手机、设备和游戏联合实测。

## 构建与安装

```powershell
.\build.ps1
.\install.ps1
.\listen.ps1
```

先启动监听器，再通过 Steam 正常启动 Magicraft。安装脚本会拒绝在游戏运行时安装，
也会拒绝覆盖未知的现有加载器文件。更新插件会备份旧 DLL。
依赖包位于 `tools/bepinex`，来源为 BepInEx 官方 GitHub 发布；游戏程序集只引用，不复制。
不需要安装 .NET SDK，构建使用 Windows 自带的 .NET Framework C# 编译器。

## 输出

- UDP：`127.0.0.1:17891`，一个 UTF-8 JSON 数据报对应一个事件。
- 日志：游戏目录 `BepInEx/MagicraftEvents/*.jsonl`，每次启动生成独立文件。
- 插件诊断：游戏目录 `BepInEx/LogOutput.log`。
- 配置：首次启动生成 `BepInEx/config/local.magicraft.eventcollector.cfg`。

```json
{
  "schemaVersion": 1,
  "source": "magicraft",
  "sessionId": "本次插件会话ID",
  "sequence": 1,
  "timestampUtc": "2026-10-06T00:00:00.0000000Z",
  "event": "player.damaged",
  "droppedEvents": 0,
  "data": { "realDamage": 12.5, "scene": "Battle", "stage": 1, "level": 1 }
}
```

| 事件 | 含义 / 来源 |
| --- | --- |
| `collector.started` | 版本和成功安装的钩子列表；当前应为 6 个 |
| `collector.stopped` | 插件正常销毁；进程强制终止时无法保证 |
| `player.damaged` | `PlayerController.AfterTakeDamage`；过滤 immuneDamage 和 realDamage ≤ 0，附带原始伤害、魔法盾伤害、陷阱和暴击标记 |
| `player.died` | `UIPlayerDead.OnShow`，死亡界面显示时上报 |
| `room.entered` / `room.left` | `RoomController.RoomEnter/RoomLeave` |
| `room.completed` | `OnRoomFinish` 的 IsFinish 从 false 变为 true；hasBossFight 表示 Boss 战房间，不等同于单个 Boss 死亡 |
| `battle.initialized` | `BattleMgr.Start_Normal` 完成，可能包含继续已有战局，不能直接认定为新开一局 |
| `scene.changed` | Unity 当前活动场景切换，附带 from/to |
| `time_scale.changed` | 时间倍率变化；0 可用于识别暂停，但加载和演出也可能修改倍率 |
| `player.snapshot` | 默认每秒读取实际 ECS 玩家数据：hp、maxHp、shield、temporaryShield、coins、keys |

所有事件附带 scene/stage/level；无对应战斗实例时 stage/level 为 null。
房间事件附带 roomId、roomType、theme、hasBossFight。
0.2.0 的受伤事件增加 `hpDamage`、`maxHp`、`hpAfter`。
经 UnitPropertyJob.Execute 的 IL 核对，`realDamage` 累计了普通/临时护盾吸收量。
`hpDamage` 使用护盾结算后剩余的 damage 字段，表示作用于生命值的伤害，过量致死伤害可能超过死亡前剩余 HP；
它不是按两次每秒快照相减计算的。`rawDamage` 为兼容旧输出保留，实际上同样是该结算后字段。
快照增加 timeScale，倍率变更采集每帧检查，以及时捕获暂停。

输出在独立线程执行，队列最多 1024 条，满时丢弃新事件并累计 droppedEvents。
UDP 不保证送达，接收端用 sessionId 和 sequence 去重、检查缺口；JSONL 用于回溯。
会话日志暂不自动轮转清理。第一版没有实现敌人击杀、胜利、拾取物品事件。

## 验证

`cd bridge; npm test`：规则映射、护盾过滤、连续受击、暂停/死亡、超时/重复消息、
设备任务并发与停止，以及模拟 V4 APP + 游戏 UDP + HTTP 面板的完整链路。

`tools/verify-output.ps1` 验证实际输出组件的 UDP / JSONL 格式和停止排空。
编译和程序集签名检查不能替代游戏内实测。首次运行请检查日志有 `6/6 hooks`，
然后进入战斗、受击、清理房间、暂停、死亡，核对监听器输出。
游戏更新可能改变入口；失败钩子会单独记录，其他采集继续工作。

临时禁用：游戏关闭后把 `BepInEx/plugins/MagicraftEventCollector/MagicraftEventCollector.dll`
移出 plugins 目录。完全撤回加载器时，仅移除本次安装新增的加载器文件，不删除游戏文件。

0.4.0 更新：主动确认退出本局会发送 battle.exited，菜单 FromUI 伤害不作为受伤或死亡。player.died 增加 confirmedDeath 标记，桥接只对确认的死亡输出反馈。

A、B 通道新增“把短时间内的多次受伤合成一次反馈”，默认关闭，时间范围 0.1–10 秒（默认 0.5 秒）。从首次有效受伤起固定计时，将窗口内选中的生命伤害比例相加，到期按原强度映射输出一次并限制在通道上限内。合并模式替代触发间隔限制；暂停、退出、房间结束、停止、采集断开会清空待合并事件。

首次运行会从 bridge/config.example.json 创建本地 bridge/config.json，默认两个通道最高强度均为 0。本地配置不提交到 Git。

