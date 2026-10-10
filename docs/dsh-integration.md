# 集成到 DSH —— 实操记录

本文记录 `dsh-birthday` 接入 `dsh` CLI（profile + patch 体系）的真实步骤，以及过程中暴露并修复的问题。目标 profile 为 `web`（GUI 在 `http://127.0.0.1:3080`）。

## 一、DSH 的插件装载模型（实测结论）

DSH 的 profile 由一串 **bundle 层**按顺序叠加而成，规则如下：

| 文件 | 作用 | 是否参与合成 |
| :--- | :--- | :--- |
| `<profile>/package.json` 的 `dsh.profile.bundles` | 声明这个 profile 要加载哪些 bundle，按序叠加 | ✅ 入口 |
| `<bundle>/package.json` 的 `dsh.bundle.patch` | 指向该 bundle 的 patch 文件 | ✅ 被读取 |
| `<bundle>/cordis.patch.yml` | **bundle 贡献的条目**（`insert` / `id` 覆盖 / `disable`） | ✅ 合成进树 |
| `<profile>/cordis.patch.yml` | 用户自己的覆盖层，最后应用 | ✅ 合成进树 |
| `<bundle>/cordis.yml` | bundle 包内的默认配置文件 | ❌ **不参与** profile 合成 |

关键点：**插件条目必须由 bundle 的 `cordis.patch.yml` 通过 `insert` 提供**，写在 profile 的 patch 里会造成同一条目插入两次（插件被加载两次）。

## 二、实际执行的步骤

### 1. 让 package.json 符合 bundle 规范

```jsonc
{
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": "./client/client.js",        // 客户端 bundle，必须显式导出
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": ["@deepseek-ai/dsh-client-ui-slots"], "platform": "web" }
  }
}
```

`dsh.client` 一旦声明，DSH 就要求包能解析 `./client`；缺少 `exports["./client"]` 会报
`client-modules: ... declares dsh.client but exports no "./client" bundle`。

### 2. bundle 的 patch 只负责插入条目（配置内联）

`cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-birthday
      name: 'dsh-birthday'
      config:
        enabledCalendars: [gregorian, lunar, islamic, hebrew]
        defaultTimezone: Asia/Shanghai
```

### 3. 把 bundle 加进 profile 的 bundles 列表

`~/.dsh/profiles/web/package.json`：

```json
"dsh": { "profile": { "bundles": [ "...", "dsh-birthday" ], "patchReload": "live" } }
```

### 4. 安装进 profile

```bash
npm pack --pack-destination "$DSH_HOME/profiles/web"
cd "$DSH_HOME/profiles/web" && pnpm add ./dsh-birthday-0.1.0.tgz
```

`pnpm` 会以 `ERR_PNPM_IGNORED_BUILDS`（better-sqlite3 原生构建脚本被策略拦截）非零退出，但依赖已装好；本插件对 SQLite 是可选依赖，会自动回退 JSON 存储。

### 5. 校验合成结果

```bash
dsh --dump-config --profile web | grep -A 12 '# == dsh-birthday'
```

期望：**恰好一条** `- id: dsh-birthday`，且带 `config`。出现两条即表示 profile patch 里重复插入了。

### 6. 重启 dsh web

新增 bundle 需要在启动时读取 `dsh.profile.bundles`，因此必须重启进程才会生效。

## 三、集成中暴露并修复的真实缺陷

| # | 现象 | 根因 | 修复 |
| :--- | :--- | :--- | :--- |
| 1 | `@deepseek-ai/schemastery does not provide an export named 'Schema'` | schemastery v3 的默认导出**本身就是** Schema 函数，没有 `Schema` 具名导出 | 改为 `import Schema from '@deepseek-ai/schemastery'` |
| 2 | `TypeError: Cannot read properties of undefined (reading 'render')` | 工具被当成 cordis 插件用了 `ctx.plugin(defineTool(...))` | 改为 `ctx.tools.register(defineTool({ ... }))`，并声明 `inject = ['tools']` |
| 3 | 同上 | `defineTool` 要求每个工具声明 `output: { schema, render }`；`parameters` 是**属性映射**而非完整 JSON Schema | 重写 5 个工具，全部补齐 `output.schema` + `output.render` + `presentCall` |
| 4 | `client-modules: ... exports no "./client" bundle` | `dsh.client` 已声明但 `exports` 里没有 `./client` | 补 `exports["./client"]` |
| 5 | 农历/伊斯兰历静默失效（`lunar package is not available`） | 编译产物是 ESM，**Node ESM 下没有 `require` 全局**；vitest 里被 Vite 垫片掩盖，DSH 下必然触发 | 改用 `createRequire(import.meta.url)`（`lunar.ts`、`db.ts`） |
| 6 | `Plugin ... missing services: database` | 顶层 `inject`/`optionalInject` 声明了 DSH 并不存在的服务名 | 顶层只声明 `inject = ['tools']`；其余依赖在 `apply()` 内用 `ctx.inject([...])` 按需绑定 |
| 7 | 浏览器报 `Cannot use import statement outside a module`，UI 横幅 `dsh-birthday: import failed` | 客户端 bundle 被当成 **普通 `<script>`** 加载，而 esbuild 按 ESM 输出（含 `import ... from "react/jsx-runtime"`） | 改以 CJS 打包再用 `window.__ModuleLoader__.load({ id, factory })` 包裹，见下节 |
| 8 | 换个 cwd 启动就"找不到生日" | 默认库路径跟随 `process.cwd()` | 默认路径优先取 `DSH_HOME`，其次宿主 `dshHomePath`，最后才回退 cwd |

第 5、7 条尤其重要：它们在单元测试里**完全看不出来**，只有以真实入口（Node ESM / 浏览器）加载才会暴露。

## 三点五、客户端 bundle 规范

DSH 把 `package.json#dsh.client` 指向的文件当**经典脚本**投放，期望它调用 `window.__ModuleLoader__.load`：

```js
window.__ModuleLoader__.load({
  id: "dsh-birthday",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");
    // ... 打包后的插件代码 ...
    exports.name = "dsh-birthday";
    exports.inject = ["slots"];
    exports.apply = apply;
    return module.exports;
  }
});
```

要点：

- **不能有顶层 `import`/`export`**，否则浏览器 SyntaxError；
- `react` / `react-dom` / `react/jsx-runtime` 由注入的 `require` 提供（每个官方客户端 bundle 都 `require("react/jsx-runtime")`，所以这是标准做法）；
- 客户端插件本身也是 cordis 插件：导出 `name` / `inject` / `apply`。

由 `scripts/bundle-client.mjs` 完成：esbuild 以 `format: 'cjs'` 打包并加上 `banner`/`footer` 包装。

### 注册到哪个 slot

| slot key | 类型 | 作用 | 必需选项 |
| :--- | :--- | :--- | :--- |
| `sidebar.panellist` | list | 侧边栏按钮，`label` 是可见文字 | `id` |
| `main` | keyed | 中央面板，`key` 与侧边栏 `id` 对应 | `key` |

两者通过同一个 id 配对，所以点击侧边栏按钮才会切到对应面板：

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: 'dsh-birthday', order: 100, label: '生日' },
  () => React.createElement(SidebarEntry, null),
));
ctx.slots.inject('main', () => ctx.slots.register(
  { name: 'main', key: 'dsh-birthday' },
  () => React.createElement(BirthdayPanel, null),
));
```

用 `ctx.slots.inject(key, cb)` 而不是直接 `register`：slot 必须由宿主包**先声明**，未声明就注册会抛错，`inject` 会等到声明后再执行。

## 四、本地验证（不依赖重启）

`scripts/verify-integration.mjs` 用 mock context 加载真实入口，并用真实 socket 跑通路由：

```bash
npm run verify
```

覆盖 27 项断言：插件导出形状、`inject` 声明、5 个工具经**真实 `defineTool`** 注册、`output.schema/render` 齐备、`calendar`/`birthday` 服务 provide、6 条路由挂载、`/calendars` 返回 4 种历法、农历 `POST /add` 产出公历锚点与星座、`/list`、同/跨时区 `sameOffset` 判定、`/delete`、404、工具 `execute` + `render` 全链路。

客户端 bundle 另有 `scripts/verify-client.mjs`（`npm run verify:client`），22 项断言：无顶层 import/export、`ModuleLoader` 包装、模块 id、`factory(require)` 导出形状、说明符白名单（仅允许 react 系列）、以及两个 slot 注册的 key/选项与组件工厂。

> 为了让脚本能解析到运行时的真实模块，`node_modules/@deepseek-ai/{cordis,dsh-tools,schemastery}` 是指向 DSH 安装目录的**目录联接**（dev-only）。DSH 运行时用自己的 resolver 提供这些包，生产安装不需要它们。

## 五、HTTP 路由

挂载在 `webServer.register({ kind: 'exact', path, handler })` 上（宿主 web server 的真实注册 API）：

```
GET  /api/birthday/list
GET  /api/birthday/calendars
GET  /api/birthday/year-info?calendar=lunar&year=2020
GET  /api/birthday/db-info
GET  /api/birthday/export
GET  /api/birthday/upcoming?tz=Asia/Shanghai&hour=9
POST /api/birthday/add
POST /api/birthday/update
POST /api/birthday/delete
POST /api/birthday/import
```

`webServer` 服务不存在时插件照常激活，只是不挂路由（有 warn 日志）。

## 六、数据库位置必须与启动目录无关

**踩过的坑**：默认路径一度跟随 `process.cwd()`，于是同一个库被写进了多个文件——01:18 那次启动用
`<cwd>/data/dsh-birthday.db`，重启后 18:18 那次用 `~/.dsh/dsh-birthday/birthdays.db`，界面上看
就是「重启后生日全没了」。数据没丢，只是新进程读了另一个文件。

现在 `resolveDefaultDbPath()` 的取值顺序**全部与 cwd 无关**：

| 顺序 | 来源 | 说明 |
| --- | --- | --- |
| 1 | `config.dbPath` | 显式配置，最高优先 |
| 2 | `process.env.DSH_HOME` | 环境变量 |
| 3 | `ctx.get('dshHomePath')` | 宿主服务（try/catch，未注入则跳过） |
| 4 | 本模块安装位置反推 | `<home>/profiles/<profile>/node_modules/...`，向上找到 `profiles` 即得 home |
| 5 | `~/.dsh` | 仅当其中存在 `profiles` 目录 |
| 6 | `<cwd>/data/dsh-birthday.db` | 仅在 DSH 之外运行时的兜底 |

第 4 条是关键：它不依赖环境变量或服务注入，只依赖插件自己被安装在哪里，因此**任何启动方式下都得到同一个路径**。

激活时会打印实际路径，便于诊断：

```
[dsh-birthday] store: <DSH_HOME>\dsh-birthday\birthdays.db (json)
```

### 历史数据自动恢复

切换路径不能让老数据「消失」。激活时（且仅当路径是**自动推导**的——显式配置 `dbPath` 时不扫描，
避免意外读取无关文件）会检查这些历史位置并**合并**进来：

- `<cwd>/data/dsh-birthday.db`
- `~/data/dsh-birthday.db`
- `~/.dsh/dsh-birthday/birthdays.db`

合并规则（`src/birthday/services/legacy-migration.ts`）：

- 不存在 → 新增；
- 已存在（姓名+历法+年月日+是否闰月+时区相同）→ 跳过，且**只在历史副本时间戳更新时才覆盖**，绝不回退用户的后续编辑；
- 原始文件**只读不删**；
- 幂等：重复启动不会产生重复记录。

非 JSON 的候选文件（SQLite/加密）不会被误读，只记一条 warn 并说明未迁移。


