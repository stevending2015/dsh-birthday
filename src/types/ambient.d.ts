/**
 * Ambient declarations for optional peer dependencies. The build compiles even
 * when the real packages are absent; at runtime DSH supplies the real modules.
 */

declare module '@deepseek-ai/cordis' {
  /** DSH's tool registry service, exposed on an activating context as `ctx.tools`. */
  export interface ToolsService {
    /** Register one tool definition; the returned function unregisters it. */
    register(definition: unknown): () => void;
    /** Look up a registered tool by name within a scope. */
    get?(name: string, ...rest: unknown[]): unknown;
  }

  export interface Logger {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug?(...args: unknown[]): void;
  }

  export interface Context {
    /** Tool registry; present because the plugin declares `inject = ['tools']`. */
    tools: ToolsService;
    plugin(plugin: any): void;
    provide(key: string, value: any): () => void;
    set?(key: string, value: any): void;
    get(key: string, ...rest: unknown[]): any;
    inject(keys: string[], cb: (...args: any[]) => void): void;
    on(event: string, handler: (...args: any[]) => void): void;
    effect(cb: () => unknown, label?: string): () => void;
    loader?: { has?: (key: string) => boolean };
    logger?: Logger;
  }
}

declare module '@deepseek-ai/dsh-tools' {
  /**
   * Build a registry-ready tool definition. The returned value is validated
   * against its declared input and output schemas by the tool runtime.
   */
  export function defineTool(options: unknown): unknown;
}

declare module '@deepseek-ai/schemastery' {
  // schemastery v3 exports a function as the default; the function itself
  // also carries method helpers (object, string, ...).
  type Schema = {
    (def: any): any;
    object: (def: any) => any;
    string: () => any;
    number: () => any;
    boolean: () => any;
    array: (item: any) => any;
  };
  const Schema: Schema;
  export default Schema;
  export { Schema };
}
