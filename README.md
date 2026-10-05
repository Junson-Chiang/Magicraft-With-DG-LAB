# Magicraft × DG-LAB 联动

让《Magicraft》的受伤事件触发郊狼反馈。A、B 通道可以分别响应敌人攻击、陷阱等伤害，强度随生命伤害变化；支持短时间内多次受伤合并反馈。主动退出本局不触发死亡反馈。

当前采集插件版本为 **0.5.0**。项目由游戏事件采集插件和电脑端联动程序组成，手机通过 DG-LAB 4 APP 配对。下面是 Windows 从源码安装的完整流程。

## 1. 安装前准备

| 所需项目 | 要求与用途 |
| --- | --- |
| Windows 64 位电脑 | 本项目脚本与构建流程面向 Windows |
| Steam 版 Magicraft | 当前按 Unity Mono 版本制作；游戏更新后需要核对采集日志 |
| Node.js | 22 或以上，用来运行联动程序；可从 [Node.js 官网](https://nodejs.org/en/download) 下载 Windows x64 安装程序，安装时保留 npm 和 PATH 选项 |
| BepInEx | 使用 [官方 5.4.23.5 发布页](https://github.com/BepInEx/BepInEx/releases/tag/v5.4.23.5) 的 `BepInEx_win_x64_5.4.23.5.zip`，不要使用 x86、Unix、IL2CPP 或 BepInEx 6 包 |
| 手机与设备 | 安装 DG-LAB 4 APP，并在 APP 中连接郊狼 V2/V3；桥接支持 COYOTE_020 / COYOTE_030 |
| 网络 | 电脑和手机均需能连接配置的 V4 中继服务器 |

源码仓库不包含游戏程序集、BepInEx 压缩包、编译好的插件或 node_modules；下载源码后需要执行下面的准备和编译步骤。不需要安装 Visual Studio 或 .NET SDK，构建使用 Windows 的 .NET Framework C# 编译器。

安装前关闭 Magicraft。设备与电极的使用位置、连接方式按设备说明操作；本软件只提供通道分流，不判断电极放置是否合适。

## 2. 下载源码并找到游戏目录

在 [项目仓库](https://github.com/Junson-Chiang/Magicraft-With-DG-LAB) 点击 **Code → Download ZIP**，解压到独立文件夹，例如 `F:\Magicraft-With-DG-LAB`。不要只打开压缩包，也不要将源码直接解压进游戏目录。

也可以使用 Git：

```powershell
git clone https://github.com/Junson-Chiang/Magicraft-With-DG-LAB.git
cd Magicraft-With-DG-LAB
```

打开 Steam，右键 Magicraft → **管理 → 浏览本地文件**。记下包含 `Magicraft.exe` 和 `Magicraft_Data` 的文件夹路径。

本项目脚本默认路径是 `E:\SteamLibrary\steamapps\common\Magicraft`，其他电脑请在后面的命令中传入自己的路径。

## 3. 准备 BepInEx 文件

从上面的官方发布页下载 Windows x64 ZIP，将**压缩包内的文件**解压到项目的 `tools\bepinex` 文件夹。最终结构应为：

```text
Magicraft-With-DG-LAB\
├─ build.ps1
├─ install.ps1
├─ start-bridge.ps1
├─ src\
├─ bridge\
│  ├─ main.js
│  └─ config.example.json
└─ tools\
   └─ bepinex\
      ├─ BepInEx\
      │  └─ core\
      │     ├─ BepInEx.dll
      │     └─ 0Harmony.dll
      ├─ winhttp.dll
      ├─ doorstop_config.ini
      └─ .doorstop_version
```

不要多嵌套一层 `BepInEx_win_x64_5.4.23.5` 文件夹。检查 `tools\bepinex\BepInEx\core\BepInEx.dll` 存在即可确认路径正确。

## 4. 安装 Node.js 依赖

在项目根目录打开 PowerShell：可以在资源管理器地址栏输入 `powershell` 并回车。以下命令均在这个窗口执行。

```powershell
node --version
npm.cmd --version
cd bridge
npm.cmd ci
cd ..
```

`node --version` 应显示 v22 或更高。`npm.cmd ci` 按锁定版本安装依赖，成功后会生成 `bridge\node_modules`。使用 `.cmd` 可以避免 Windows 对 npm.ps1 的执行策略限制。

如果提示找不到 node/npm，安装 Node.js 后关闭当前终端，重新打开再试。

## 5. 编译并安装游戏采集插件

先将下面的 `$gamePath` 改为你的游戏目录，然后执行：

```powershell
$gamePath = 'E:\SteamLibrary\steamapps\common\Magicraft'
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -GamePath $gamePath
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -GamePath $gamePath
```

这里的 ExecutionPolicy 参数只作用于这次启动的 PowerShell，不修改系统永久执行策略。

编译成功会显示 `Built dist\MagicraftEventCollector.dll`。安装成功会显示插件目标路径：

```text
<游戏目录>\BepInEx\plugins\MagicraftEventCollector\MagicraftEventCollector.dll
```

安装脚本会在没有 BepInEx 时复制加载器；已经有 BepInEx 时只安装插件。游戏运行时会拒绝安装，更新插件时会备份旧 DLL。若发现未知的 `winhttp.dll`、`doorstop_config.ini` 等现有加载器文件，脚本会拒绝覆盖：先确认已有 Mod 加载器的来源与兼容性，再安装。

通过 Steam 启动一次游戏，再查看：

```text
<游戏目录>\BepInEx\LogOutput.log
```

应看到 `Event collector ready: 9/9 hooks`。如果日志不存在或出现 `Hook unavailable`，先按下面的常见问题排查。插件更新后需要重新启动游戏，已运行的游戏不会自动加载新 DLL。

## 6. 启动电脑联动程序

回到项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-bridge.ps1
```

也可以直接运行：

```powershell
cd bridge
node main.js
```

保持这个终端打开。首次运行会从 `bridge/config.example.json` 创建 `bridge/config.json`，默认两个通道的最高强度均为 **0**。

复制终端显示的**完整控制面板链接**到浏览器，包含 `#` 后的访问令牌，例如：

```text
http://127.0.0.1:17892/#<本次启动生成的令牌>
```

只输入端口地址会缺少访问令牌。面板仅供这台电脑访问，手机用 APP 扫描配对二维码，不需要打开电脑的 localhost 页面。每次重启联动程序，请使用新输出的链接。

运行联动程序时不要同时运行 `listen.ps1`，两者会占用相同的 UDP 端口。

## 7. 手机配对与设备选择

1. 在手机 DG-LAB 4 APP 中连接郊狼设备。
2. 在电脑面板点击 **生成手机配对码**，用 APP 的配对扫码功能扫描二维码，并按 APP 提示将设备提供给此连接。
3. 等待电脑显示手机已连接，设备下拉框出现对应郊狼。
4. 选择设备，点击 **使用此设备**。这个动作会将两个通道归零。
5. 检查面板的 A、B 通道状态。要使用的通道必须在手机 APP 中开启输出；如显示“手机 APP 已暂停输出”，先到 APP 开启对应通道。

默认中继地址为 `wss://trex.dungeon-lab.cn/v4`。如需修改，在“连接地址（通常无需修改）”中填写兼容的 V4 中继地址并保存，再重新生成配对码。软件不会自动部署中继。

## 8. 配置 A、B 通道并开始测试

A、B 各有独立配置。默认 **A 响应敌人攻击，B 响应陷阱伤害**。点击“敌人 → A，陷阱 → B”可以恢复这组伤害勾选，但不会改变强度。

| 面板选项 | 含义 |
| --- | --- |
| 使用此通道 | 是否处理这个通道的游戏事件 |
| 伤害来源勾选 | 仅响应选中的来源；同一来源在 A/B 都选中时会触发两个通道 |
| 轻微受伤时的强度 | 强度映射的起点 |
| 单次反馈的最高强度 | 输出上限；0 表示不产生反馈 |
| 扣多少血达到最高强度 (%) | 按生命上限计算。例如 20 表示损失生命上限的 20% 时达到最高强度 |
| 每次反馈持续几秒 | 单次反馈时长，范围 0.1–3 秒 |
| 两次触发至少间隔几秒 | 普通模式的触发间隔；正在反馈时，更大伤害可以提高强度，但不会延长原结束时间 |
| 把短时间内的多次受伤合成一次反馈 | 开启后先收集伤害，窗口结束再输出一次 |
| 收集合并伤害的时间（秒） | 范围 0.1–10 秒，默认 0.5 秒；从首次有效受伤开始固定计时 |
| 死亡时也触发此通道 | 真正死亡时使用该通道最高强度，随后关闭联动；主动退出本局不触发 |
| 死亡时反馈几秒 | 死亡反馈时长，范围 0.1–3 秒 |

合并模式会将窗口内**该通道选中的生命伤害比例相加**，然后按同一强度公式计算一次反馈。例如窗口 0.5 秒内受到 2% 和 3% 的生命伤害，按合计 5% 计算；最高强度仍是上限。后续受伤不延长窗口，合并模式不使用普通触发间隔设置。开启后出现等待窗口结束的延迟是正常行为。

强度计算公式：

```text
伤害比例 = 生命伤害 / 最大生命值
强度 = 最低强度 + (最高强度 - 最低强度) × min(伤害比例 / 满强度比例, 1)
```

仅计算作用于生命值的伤害，护盾吸收部分不触发。中毒/灼烧在无法确认攻击者时会单列为“来源不明”；无法识别的其他伤害不会自动归为敌人。

测试步骤：

1. 勾选需要的通道与伤害来源，填写适合自己的强度和时长。软件没有适用于所有人的固定强度推荐。
2. 点击 **保存设置（需重新开始）**。保存会结束当前反馈、清空待合并伤害并将 A/B 归零，手机配对保留。
3. 在游戏中进入一局活动战斗。面板应显示“战斗中”和玩家生命值，不能处于暂停状态。
4. 点击 **开始响应游戏伤害**。至少一个启用通道的最高强度须大于 0。
5. 受伤后查看“最近一次受伤”的来源和生命伤害，核对是否匹配所选通道。合并模式下等待设定窗口结束。
6. 点击 **停止输出并归零** 可随时停止两个通道。

暂停、离开房间、房间完成会结束当前输出并丢弃待合并伤害。主动退出本局、真正死亡、离开战斗场景、连接断开或采集异常会关闭联动；恢复后根据面板提示重新点击“开始响应游戏伤害”。不要将面板显示“手机已连接”误认为联动已经开启。

## 0.5.0：更多体验设置与诊断

在每个通道下方展开 **更多体验设置：低血量、敌人倍率、波形与关卡事件**。

- **低血量时增强反馈（可选）**：默认关闭。可设置生命阈值 1–100% 和增强倍数 1–5。按每次受伤后的生命比例判断；缺少事件生命值时使用新鲜快照。它放大参与强度映射的伤害比例，不提高最高强度上限。
- **敌人伤害倍率**：普通敌人、精英、Boss 分别设置 0–5 倍，默认均为 1。0 表示忽略对应伤害。只对确认的敌人来源应用，未知攻击者不猜测敌人类型。低血量增强和敌人倍率相乘后参与强度映射。
- **来源波形**：每个伤害来源可选 SDK 提供的 24 种波形；默认保留气泡。合并窗口中有多种波形时，使用加权伤害比例最大的一次受伤所选波形，比例相同则保留较早一次。波形名称来自 SDK，实际感觉取决于设备和使用方式。
- **关卡事件反馈**：进入 Boss 房间、普通房间完成、Boss 房间完成、章节完成、本局通关分别配置开启状态、固定强度、时长和波形。默认全部关闭，固定强度不能突破通道最高强度。Boss 房间完成按房间完成事件识别，并不等同于单个 Boss 死亡。章节完成在战斗场景的章节过渡入口采集，本局通关在普通模式通关结算入口采集；无尽模式结束不作为胜利。0.5.0 插件新增这两个入口，启动日志应为 9/9 hooks。联动未开启、游戏暂停、玩家已死亡或快照超时时不会输出事件反馈；通关后关闭联动。尚需游戏内逐项联合实测。

**反馈触发记录**保存最近 100 条，面板显示最近 20 条，包括通道、来源、计算强度、波形、倍率及未触发原因。记录中的“已下发”指指令交给设备发送模块，不是设备实测结果；设备发送失败仍会在运行记录中显示并停止联动。记录保存在内存，重启会清空。

**伤害合并进度**显示 A/B 各自的累计次数、原始扣血比例、剩余窗口时间和应用倍率后的预计强度，约每 0.25 秒刷新。预计值只用于显示，不主动输出。保存、暂停、退出或停止会取消待合并伤害。

**保存与切换方案**提供两个内置方案：敌人与陷阱分流保留当前强度，轻量体验将上限降低到当前值和 5 的较小值、时长设为 0.3 秒，并关闭死亡、低血量增强和关卡事件反馈。也可以填写名称，将当前页面填写保存为自定义方案（最多 20 个）；同名保存会覆盖原方案。保存方案不改变正在运行的配置，点击“应用方案并停止输出”才会保存为运行配置并归零。自定义方案会恢复保存时的完整通道设置，包括强度，应用前请核对。重新开启需要点击“开始响应游戏伤害”。自定义方案在 bridge/presets.json，和个人 config.json 一样不提交到 Git。

## 9. 常见问题

| 现象 | 排查方法 |
| --- | --- |
| Missing dependency | 检查 BepInEx 解压层级，以及 GamePath 是否包含正确的 Magicraft_Data\Managed；本插件不适用于不同运行时的游戏版本 |
| Close Magicraft before installing | 完全退出游戏，再执行安装命令 |
| PowerShell 提示禁止运行脚本 | 使用教程中的 `powershell -ExecutionPolicy Bypass -File ...` 命令；安装依赖使用 `npm.cmd` |
| 没有 BepInEx 日志 | 检查游戏根目录是否有加载器文件和 BepInEx/core；从 Steam 启动后再查日志，避免重复加载器冲突 |
| 不是 9/9 hooks | 查看 Hook unavailable 的具体方法；确认插件版本、游戏版本及是否重启了游戏 |
| EADDRINUSE | 相同端口被占用；关闭旧联动进程或 listen.ps1 后重试。默认 UDP 17891、HTTP 17892 |
| 面板访问失败 | 从当前终端重新复制包含令牌的完整链接；确认终端仍在运行 |
| 扫码后没有设备 | 检查手机 APP 是否已连接设备并将设备提供给配对连接，以及两端中继地址是否一致、网络是否可用 |
| “需要游戏处于活动战斗中” | 进入战斗、关闭暂停菜单；检查生命值快照是否更新、插件 UDP 是否开启 |
| 受伤但没有感觉 | 检查已点击“开始响应游戏伤害”、已选设备、对应通道最高强度大于 0、APP 未暂停输出；再核对最近受伤来源是否勾选、是否仅护盾受伤、是否正在等待合并窗口 |
| 保存后不再响应 | 保存会停止输出；再次点击“开始响应游戏伤害” |
| B 通道没有反馈 | 新配置 B 最高强度默认 0，需要自行设置；检查陷阱伤害勾选和手机 B 通道状态 |
| 游戏更新后采集异常 | 检查插件日志钩子与伤害来源；程序集入口改变可能需要更新插件 |

采集插件配置文件位于 `<游戏目录>\BepInEx\config\local.magicraft.eventcollector.cfg`。默认 UDP 开启，端口为 17891；若手动改端口，必须与本地 `bridge/config.json` 的 udpPort 一致。采集快照默认每秒一次，超过 5 秒未更新会关闭联动。

网络断开时无法保证电脑能立即让远程设备归零；程序使用自动到期的临时强度任务，单次输出最长 3 秒。需要立刻终止时使用手机 APP 或设备的停止操作。

## 10. 更新、禁用和卸载

更新源码后，关闭游戏和联动终端，重新安装依赖、编译并安装：

```powershell
# 使用 Git 下载的项目先执行 git pull；ZIP 用户下载新版覆盖源码。
cd bridge
npm.cmd ci
cd ..
$gamePath = 'E:\SteamLibrary\steamapps\common\Magicraft'
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -GamePath $gamePath
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -GamePath $gamePath
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-bridge.ps1
```

重新启动游戏、扫码配对并选择设备。本地 `bridge/config.json` 保存个人设置，不提交到仓库；ZIP 更新时保留这个文件。

临时禁用插件：游戏关闭后，将 `BepInEx\plugins\MagicraftEventCollector\MagicraftEventCollector.dll` 移出 plugins 目录。只卸载本插件时不要删除其他 Mod 文件。只有确认加载器是本项目首次安装、且没有其他插件依赖时，才按安装记录移除新增的 BepInEx 加载器文件。

## 开发与事件诊断

完整测试：

```powershell
cd bridge
npm.cmd test
```

测试覆盖规则映射、护盾过滤、伤害分流、合并窗口、退出/死亡、暂停、超时、设备任务和模拟 V4 APP + UDP + HTTP 链路。模拟测试不能代替真实游戏、手机与设备联合测试。

仅调试采集事件时，在项目根目录执行以下命令，再启动游戏（此时不要运行联动程序）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\listen.ps1
```

| 输出位置 | 内容 |
| --- | --- |
| UDP 127.0.0.1:17891 | 一个 UTF-8 JSON 数据报对应一个事件 |
| 游戏目录 BepInEx/MagicraftEvents/*.jsonl | 每次启动的独立事件日志 |
| 游戏目录 BepInEx/LogOutput.log | 插件加载和钩子诊断 |
| bridge/config.json | 个人联动设置，首次启动自动生成 |

| 事件 | 含义 |
| --- | --- |
| collector.started / collector.stopped | 插件启动/正常销毁；启动包含版本和 9 个钩子状态 |
| player.damaged | 生命伤害、最大生命值、伤害来源、攻击者类型、陷阱/暴击标记等 |
| player.died | 确认的死亡，附带 confirmedDeath 标记 |
| chapter.completed / battle.victory | 章节过渡与确认的本局通关（普通模式） |
| battle.exited | 菜单主动退出，停止联动，不触发死亡反馈 |
| battle.initialized | BattleMgr.Start_Normal 完成，可能包含继续已有战局 |
| room.entered / room.left / room.completed | 房间进入、离开、完成；房间完成不等同于单个 Boss 死亡 |
| scene.changed / time_scale.changed | 活动场景与游戏时间倍率变化 |
| player.snapshot | 实际 ECS 玩家生命、护盾、钱币、钥匙和时间倍率，默认每秒采集 |

所有事件带 schemaVersion、source、sessionId、sequence、timestampUtc、data；data 附带 scene/stage/level。UDP 不保证送达，桥接用会话和序号检查重复与缺口。事件日志暂不自动清理。

`hpDamage` 来自护盾结算后的 damage 字段，过量致死伤害可能超过受伤前剩余生命；`realDamage` 包含普通/临时护盾吸收量，不能用作纯生命伤害。来源优先检查陷阱标记，再根据攻击者单位分类；无法确认时保留未知。

当前没有单个敌人击杀或物品拾取反馈。通信由 dglab-kit V4 SDK 完成，不自动部署原始 WebSocket 服务器。
