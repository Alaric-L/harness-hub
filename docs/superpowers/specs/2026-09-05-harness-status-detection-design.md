# HarnessHub — Harness 使用状态检测重构 Spec

> 关联文档：`../../设计文档.md`（第七节 Dashboard、第九节技术架构）
> 视觉参考：[`2026-09-05-harness-card-redesign.html`](2026-09-05-harness-card-redesign.html)（同目录，三种卡片状态示例）
> 状态：草案，待评审
> 范围：仅涉及"该 harness 是否在使用 / 版本信息如何展示"这一判定逻辑与相关 UI，不改变 MCP / Skills / 提示词三个页面已有的读写机制。

---

## 一、背景与问题

### 1.1 现状

当前 Dashboard 的 Harness 概览卡片，用一套逻辑同时回答两个问题：

1. 这个 harness 在不在用？
2. 版本是多少，要不要更新？

判定方式统一为：本地 `{bin} --version` 子进程探测 + npm registry `dist-tags.latest`。探测成功 → "已安装"；探测失败 → "未安装"，弹"安装"按钮；版本不一致 → "可更新"。

`AGENT_VERSIONS` 现有结构（对应原型 `设计原型.html` Dashboard 概览 mock 数据块）：

```js
{agentId:'claude', version:null, latestVersion:'2.0.28', error:'claude 未安装或不在 PATH 中', installed:false}
```

Dashboard 统计卡口径：`已安装 Harness = 版本探测成功的 agent 数`（设计文档第七节 Dashboard 统计卡定义）。

ZCode 已经是一个例外：因为它是纯桌面应用、没有 npm 包，产品为它单独写了一条判定——"按配置目录存在性判定已安装，版本列显示 —"（设计文档第七节 ZCode 补充说明）。

### 1.2 问题

`--version` 探测只能覆盖"通过 npm 全局安装 CLI 二进制"这一种使用形态。已确认：本产品覆盖的 8 个 harness，无论用户是走 CLI、IDE 插件（如 Claude Code 的 VS Code 插件）、还是桌面客户端，最终读写的都是同一份配置文件——不存在"客户端配置和 CLI 配置是两份互不相通的文件"的情况。既然如此，"探测不到 CLI" 就完全不能代表"没在用这个 harness"，只能代表"这次没找到那个 npm 二进制"。

由此产生的具体问题：

1. 插件 / 客户端用户被误判为"未安装"，卡片显示警示色，且出现的"安装"按钮对他们没有意义（他们根本不需要装 CLI）。
2. Dashboard「已安装 Harness」统计数字失真，可能被系统性低估。
3. "更新"按钮语义模糊——探测到"可更新"其实只是 CLI 这一个安装形态可更新，容易让人误以为整个 harness（包括用户实际在用的插件/客户端）需要更新。
4. ZCode 的"配置目录存在性"判定其实是正确答案，但目前只开给了它一家，其余 7 个仍走 CLI 探测这条错误默认路径，代码里因此存在两套并行逻辑。

### 1.3 结论

**配置目录 / 关键配置文件是否存在**，是唯一能够跨越"CLI / 插件 / 客户端"这三种使用形态、可靠反映"用户是否在使用这个 harness"的信号。CLI 版本探测应当从"决定安装状态的主判据"降级为"探测成功才展示、探测失败也不影响任何其它状态"的次要信息。

---

## 二、目标与非目标

### 2.1 目标

- 以"配置根目录与 MCP 落点文件存在性"（下称**配置检测**）作为全部 8 个 harness 统一的主状态判据，替换现有的 CLI 探测主导逻辑，不再有 ZCode 式的特例分支。
- CLI 版本探测（本地 `--version` + npm registry latest）保留，但角色降级为独立的次要信息通道：探测失败不影响主状态，不阻塞任何按钮或操作。
- 按上述模型重做 Dashboard 统计卡、Harness 概览卡片的文案与交互。
- 调整数据模型与 adapter 接口，使这套逻辑对未来新增 harness 天然适用，无需重复填坑。

### 2.2 非目标（本期不做）

- 不引入"使用方式"手动标记（CLI 自动检测 / 桌面客户端 / IDE 插件）。已确认所有客户端共享配置，不需要靠用户手动分类来调整展示；留作后续可选增强。
- 不新增使用独立配置文件的 harness 条目（例如某些产品的独立聊天应用如果配置文件与本表完全不同，属于另一个话题）。本次已确认 8 个 harness 范围内不存在这种情况。
- 不改变 MCP / Skills / 提示词三个页面已有的读写路径与交互，它们本来就是直接对配置文件做操作，不依赖版本探测结果。

---

## 三、术语定义

| 术语 | 定义 |
|---|---|
| 配置检测 Config Detection | 检查某 harness 的配置根目录与 MCP 落点文件是否存在于本机文件系统，用来判断该 harness 是否已被使用 |
| 已配置 Configured | 配置检测判定通过（配置根目录存在且 MCP 落点文件存在） |
| 未配置 Unconfigured | 配置检测判定未通过（含仅有根目录、或仅有提示词文件的情形） |
| CLI 版本信息 CLI Version Info | 本地 PATH 中探测到的可执行文件版本号 + npm registry 最新版本号，仅供参考，不参与"已配置/未配置"的判定 |

---

## 四、检测逻辑设计

### 4.1 配置检测（主状态）

**判定规则**：

```
已配置 = 配置根目录存在 AND MCP 落点文件存在
```

不使用 Skills 目录作为判定依据。原因：Skills 部署本身要求"写入前根目录检查"通过（设计文档第四节「写入前根目录检查」），也就是说 Skills 目录只有在配置根目录已存在的前提下才可能被 HarnessHub 写入——拿它做判定会构成循环依赖，且不是所有 harness 都会主动产生这个目录。

提示词文件同样不参与判定。原因：提示词文件是可选的内容文件、并非 harness 运行的必需文件，且 AGENTS.md 等文件名正成为多个工具共用的通用约定，用户可能为其它用途创建它们，存在性信号弱；MCP 落点文件是 harness 的核心配置文件，与配置根目录组合已构成足够可靠的"确实在用"信号。

也不使用"配置根目录存在即可"这么宽松的规则：用户可能手滑建了个空文件夹，或者其它程序误建了同名目录，仅目录存在不足以说明该 harness 真的被配置过。

**逐 harness 检测路径**（取自设计文档第一节表格）：

| Harness | 配置根目录 | MCP 落点文件 |
|---|---|---|
| DeepSeek Harness | `~/.dsh` | `~/.dsh/profiles/web/cordis.patch.yml` |
| OpenCode | `~/.config/opencode` | `~/.config/opencode/opencode.json` |
| ZCode | `~/.zcode` | `~/.zcode/cli/config.json` |
| Codex | `~/.codex` | `~/.codex/config.toml` |
| Claude Code | `~/.claude`（另需检测 `~/.claude.json`，不在该目录下） | `~/.claude.json` |
| Grok Build | `~/.grok` | `~/.grok/config.toml` |
| Gemini CLI | `~/.gemini` | `~/.gemini/settings.json` |
| Hermes | `~/.hermes` | `~/.hermes/config.yaml` |

注意 Claude Code 的特殊性：MCP 落点文件 `~/.claude.json` 并不在配置根目录 `~/.claude` 内部，是同级的独立文件。检测时"配置根目录"这一项对 Claude Code 应实际理解为"`~/.claude` 目录存在 或 `~/.claude.json` 文件存在"，任一命中即视为根目录条件满足；由于 MCP 落点文件即 `~/.claude.json`，两项合取后 Claude Code 的判定实际退化为"`~/.claude.json` 存在"，不会因目录结构和其它 7 个 harness 不一致而漏判。

**目录覆盖联动**：Harness 管理页支持"配置目录覆盖"（设计文档第六节）。配置检测必须读取用户设置的覆盖路径，而非硬编码默认路径——覆盖后，MCP 落点 / Skills 目录 / 提示词文件均相对新目录重新计算，检测逻辑同理跟随。

**实现方式**：本地同步文件系统调用（`fs.existsSync` 或等价 API），无网络依赖，理论上应在几十毫秒内对全部 8 个 harness 完成检测，无需 loading 态覆盖主状态展示。

### 4.2 CLI 版本探测（次要信息通道）

保留现有实现不变：本地 `{bin} --version` 子进程探测 + npm registry `dist-tags.latest` 网络请求，semver 严格比较判定"可更新"。

角色调整：

- 探测失败（未找到二进制、非 npm 分发、网络请求失败）**不再影响**"已配置/未配置"的主状态，只意味着"这张卡片没有 CLI 版本信息可以展示"。
- 该信息完全独立于主状态渲染，即使为 `null`，也不阻塞卡片的其它区域、不影响 MCP/Skills/提示词三页对该 harness 的可用性判断。
- ZCode 原有的专属分支（"版本列显示 — /未知，状态徽标为已安装"）可以直接删除——在新模型下，ZCode 只是"配置检测通过 + CLI 信息恒为 null"的普通案例，与其它 7 个 harness 走同一套渲染代码，不需要特判。

---

## 五、数据模型变更

### 5.1 类型定义

原结构（`AGENT_VERSIONS`，原型 Dashboard 概览 mock 数据）：

```ts
interface AgentVersionInfo {
  agentId: string;
  version: string | null;
  latestVersion: string | null;
  error: string | null;
  installed: boolean;
}
```

新结构：

```ts
interface AgentStatus {
  agentId: string;
  configDetected: boolean;     // 主状态：4.1 节规则判定结果
  configPath: string;          // 实际命中的检测路径，用于详情面板 / 排错展示
  cli: CliVersionInfo | null;  // 次要信息，探测失败或不适用（如 ZCode）时为 null
}

interface CliVersionInfo {
  version: string | null;      // 本地探测到的版本；null = 未找到对应 CLI
  latestVersion: string | null;// npm registry 最新版本；null = 网络失败或非 npm 分发
  error: string | null;        // 探测失败原因，用于 tooltip 展示
  checkedAt: number;           // 探测时间戳（epoch ms），用于"上次检测于 X 分钟前"
}
```

`getAgentVersions`（渲染层初始化与「刷新版本」按钮当前调用的探测函数）拆分职责，改为两个独立函数：

- `detectAgentConfigs(): AgentStatus[]`——仅做 4.1 节的文件系统检测，同步/极快，Dashboard 首次渲染直接调用，不等待任何网络请求。
- `probeCliVersions(agentId): Promise<CliVersionInfo>`——保留原有子进程 + npm 请求逻辑，逐个 harness 并发执行，探测完成后异步回填对应卡片的次要信息区，不阻塞主状态先行展示。

### 5.2 迁移影响

`AGENT_VERSIONS`/`AgentStatus` 属于运行时探测结果，不落库（不写入 `data.json`），因此没有旧数据迁移或兼容性负担。Skills 的 `SkillTargetId`/`apps` 等既有持久化结构不受本次改动影响。

---

## 六、页面改动

### 6.1 Dashboard 统计卡

- 「已安装 Harness」→ 改名为「已配置 Harness」。
- 计数口径：`AGENT_STATUS.filter(s => s.configDetected).length`。
- 删除原有"版本数据未加载时回退『已接入』总数"的兜底逻辑（设计文档第七节统计卡定义）——因为配置检测是同步本地调用，主状态数字本来就应该是瞬时准确的,不存在"数据未加载"的中间态需要兜底。

### 6.2 Harness 概览卡片重构

卡片信息分两层，不再是原来"一个徽标扛住安装状态+版本可更新+最新"三件事的平铺结构：

**头部：主徽标**（仅反映配置检测结果）
- 已配置（绿色）
- 未配置（中性灰，不使用警示/危险色——这只是"还没配置"，不是故障）

**次要区：CLI 版本信息**（弱化样式：小字号、灰色调，明确视觉上从属于主徽标）

卡片保留一行弱化的「MCP x · Skills x · 提示词 x」计数（位于次要信息区之后，展示该 harness 在 HarnessHub 内的纳管情况，属展示信息、与配置状态判定无关）。

状态 × 展示 × 操作矩阵：

| 配置检测 | CLI 信息 | 主徽标 | 次要信息文案 | 操作按钮 |
|---|---|---|---|---|
| 已配置 | 有版本号，可更新 | 已配置（绿） | "0.18.4 → 0.19.1" + 可更新标签 | [更新 CLI] |
| 已配置 | 有版本号，已最新 | 已配置（绿） | "已是最新 CLI 版本 vX.Y.Z" | 无按钮（纯文案） |
| 已配置 | 未探测到 CLI | 已配置（绿） | "未检测到本地 CLI，可能通过 IDE 插件或桌面客户端使用" | [查看安装方式]（ghost，非强制） |
| 未配置 | 不探测 / 无意义 | 未配置（灰） | "`~/.xxx` 未找到" | [查看安装选项]（primary） |
| 探测中 | — | 加载中（…） | 骨架屏占位 | 按钮禁用态 |

按钮文案统一把"CLI"三个字带出来（如"更新 CLI"而非笼统的"更新"），避免暗示整个 harness（包括用户实际在用的插件/客户端形态）都需要更新。

**按钮行为**：

- [更新 CLI]：沿用现有 `installAgent`（npm 全局安装/更新），完成后仅回填该卡片的 CLI 次要信息区。
- [查看安装方式] / [查看安装选项]：在系统默认浏览器打开该 harness 的官网（不执行任何安装动作）。官网链接常量与 `AGENT_TOOL_META` 同处维护：

| Harness | 官网链接 |
|---|---|
| DeepSeek Harness | https://github.com/deepseek-ai/deepseek-harness |
| OpenCode | https://opencode.ai/docs |
| ZCode | https://zcode.z.ai/docs/install |
| Codex | https://github.com/openai/codex |
| Claude Code | https://code.claude.com/docs |
| Grok Build | https://docs.x.ai/build/overview |
| Gemini CLI | https://github.com/google-gemini/gemini-cli |
| Hermes | https://github.com/NousResearch/hermes-agent |

> 注：`hermes-agent` npm 包为社区非官方 bridge（包自述），Hermes 官方上游为 NousResearch/hermes-agent，链接以上游为准。

### 6.3「刷新版本」按钮职责调整

建议改名为「刷新状态」，点击后分两步：

1. 立即执行一次全量 `detectAgentConfigs()`，本地文件系统调用，几乎同步返回，主状态区先行刷新。
2. 并发发起 `probeCliVersions()`，探测完成后局部更新各卡片次要信息区，不阻塞主状态的展示。

这样用户点刷新后能立刻看到准确的"已配置/未配置"结果，不用等 npm 网络请求这种相对慢的部分。

### 6.4 文案与提示

次要信息区旁加一个 `(i)` 提示图标，hover/点击展示：

> 此信息通过本地命令行检测获得，仅适用于通过 CLI 安装的场景；如果你通过插件或桌面客户端使用，该信息不可用，但不影响 MCP / Skills / 提示词的管理功能。

---

## 七、对现有设计文档的具体改动

| 位置 | 现有表述 | 改为 |
|---|---|---|
| 第七节 Dashboard，统计卡定义 | "已安装 Harness 数（= 版本探测成功的 agent 数，版本数据未加载时回退「已接入」总数）" | "已配置 Harness 数（= 配置检测判定存在的 agent 数，本地文件系统检测，无需等待版本探测）" |
| 第七节 Dashboard，状态徽标 | "状态徽标（未安装 / 可更新 / ✓ 最新 / 加载中「…」）" | "主徽标：已配置 / 未配置 / 加载中；次要区：CLI 版本（可更新 / 已最新 / 未检测到）" |
| 第七节 Dashboard，版本探测补充 | "ZCode 为桌面应用（无 CLI/npm 包），按配置目录存在性判定已安装，版本列显示「—」/「未知」" | 删除此条特例说明——ZCode 与其余 7 个 harness 统一走 4.1 节的配置检测逻辑，不再是特例 |
| 第九节 9.1 Adapter 模式 | 未提及配置检测与 CLI 探测的分工 | 补充说明：每个 adapter 除读写配置外，需暴露 configPaths（根目录 + MCP 落点文件路径，检测仅依赖这两项），供配置检测复用，避免检测逻辑和 adapter 路径定义脱节、后续改路径忘记同步两处 |
| 第九节 9.3 安全机制 | 不涉及 | 不受影响，本次改动不涉及写入/备份逻辑 |

---

## 八、边界情况

- **Windows 路径展开**：所有 `~/` 路径检测前需展开为 `%USERPROFILE%` 对应路径，配置目录覆盖场景同理，覆盖值也要做同样的路径规范化处理。
- **空目录**：仅配置根目录存在、MCP 落点文件不存在——按 4.1 节规则判定为"未配置"，不会被空文件夹误判命中。
- **首次读取权限错误**：如果检测过程中遇到权限拒绝等文件系统异常，应视为"未配置"并在 `configPath` 或专门的错误字段中记录原因，避免异常导致整个 Dashboard 卡片渲染中断。
- **Claude Code 目录/文件不一致的结构**：见 4.1 节末尾专门说明，检测时需要同时兼容"目录"和"同级独立文件"两种落点形态，不能假设所有 harness 的 MCP 落点文件都在配置根目录内部。

---

## 九、验收标准

- [ ] 全部 8 个 harness 的"已配置/未配置"判定均基于 4.1 节的文件系统检测规则，代码中不再存在 ZCode 专属分支。
- [ ] 仅提示词文件存在（无 MCP 落点文件）的 harness 判定为「未配置」——提示词文件不参与判定。
- [ ] CLI 探测失败时，卡片主徽标不受影响，不显示警示/危险色，不出现"安装"类按钮。
- [ ] Dashboard「已配置 Harness」统计数字与本机实际配置文件情况一致，不依赖网络请求是否完成。
- [ ] Harness 管理页设置"配置目录覆盖"后，对应 harness 的配置检测路径同步生效。
- [ ] 「刷新状态」点击后，主状态区先于 CLI 版本信息区完成刷新。
- [ ] [更新 CLI] 完成后仅回填 CLI 次要信息区；[查看安装方式] / [查看安装选项] 在默认浏览器打开对应官网链接。
- [ ] MCP / Skills / 提示词三个页面的既有读写行为不受本次改动影响，回归测试通过。

---

## 十、后续可选增强（不在本期范围）

- 支持用户在 Harness 管理页手动标记"使用方式"（CLI 自动检测 / 桌面客户端 / IDE 插件），标记为非 CLI 后，Dashboard 直接隐藏 CLI 版本信息区，连"未检测到"提示都不出现。
- CLI 探测结果加上 `checkedAt` 时间戳后，可以在卡片上展示"上次检测于 X 分钟前"，减少用户对"信息是否过期"的疑虑。
