import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./log.js";

/**
 * Клиент к `sf-mcp` — MCP-серверу игровых данных Foreman.
 *
 * Зачем адаптеру вообще его проксировать: системный промпт Foreman рассказывает
 * модели про инструменты игровых данных (`total_raw_inputs` и прочие). Если
 * адаптер отдаёт пустой список, модель всё равно зовёт их по памяти о промпте,
 * Foreman такой инструмент не находит, и ход заканчивается без ответа — ни
 * текста, ни ошибки (разобрано на P-3 10.11.2026).
 *
 * Поэтому в v0 адаптер пропускает инструменты `sf-mcp` насквозь. Белый список
 * (S2) и собственные инструменты из реестра (V-3) надеваются сверху: там же
 * появляется свой системный промпт через `SYSTEM_PROMPT_PATH`, после чего
 * прятать игровые инструменты станет безопасно.
 */
export class UpstreamMcp {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;

  public constructor(
    private readonly url: string,
    private readonly log: Logger,
  ) {}

  private async connect(): Promise<Client> {
    if (this.client !== undefined) return this.client;
    if (this.connecting !== undefined) return this.connecting;

    this.connecting = (async () => {
      const client = new Client({ name: "ficsitai-adapter-upstream", version: "0.0.1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(this.url)));
      this.log.info(`подключился к sf-mcp: ${this.url}`);
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } catch (err: unknown) {
      this.log.error(`не удалось подключиться к sf-mcp (${this.url})`, err);
      throw err;
    } finally {
      this.connecting = undefined;
    }
  }

  /** Сбрасывает соединение: следующий вызов подключится заново. */
  public reset(): void {
    const client = this.client;
    this.client = undefined;
    void client?.close().catch(() => undefined);
  }

  public async listTools(): Promise<Tool[]> {
    const client = await this.connect();
    try {
      const result = await client.listTools();
      return result.tools;
    } catch (err: unknown) {
      this.reset();
      throw err;
    }
  }

  public async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = await this.connect();
    try {
      return (await client.callTool({ name, arguments: args })) as CallToolResult;
    } catch (err: unknown) {
      this.reset();
      throw err;
    }
  }
}
