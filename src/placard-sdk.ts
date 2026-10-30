/**
 * Minimal Placard host contracts used by this plugin.
 * Kept local so the repo does not depend on the Placard monorepo.
 * Keep in sync with `@placard/module-sdk` major 0.
 */

export type ModuleHostFetch = (
  path: string,
  init?: globalThis.RequestInit,
) => Promise<globalThis.Response>

export type ModuleMcpResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string }

export type ModuleMcpContext = {
  readonly moduleId: string
  readonly rootDir: string
  readonly ownerId: string
  readonly hostFetch: ModuleHostFetch
}

export type ModuleMcpToolDef = {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export type ModuleMcpTool = {
  readonly def: ModuleMcpToolDef
  readonly handler: (
    args: Record<string, unknown>,
    ctx: ModuleMcpContext,
  ) => Promise<ModuleMcpResult>
}

export type ModuleHttpContext = {
  readonly moduleId: string
  readonly pathSuffix: string
  readonly rootDir: string
  readonly ownerId: string
  readonly hostFetch?: ModuleHostFetch
}

export type CreateModuleResult = {
  readonly createHttpApp?: (
    request: globalThis.Request,
    ctx: ModuleHttpContext,
  ) => Promise<globalThis.Response> | globalThis.Response
  readonly mcpTools?: ReadonlyArray<ModuleMcpTool>
}
