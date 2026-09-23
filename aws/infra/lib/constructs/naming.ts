/**
 * Centralized resource-name computation (DEVELOPMENT.md §3: "no hard-coded names except via
 * a naming.ts helper"). Every other construct asks `Naming` for a name instead of writing a
 * literal string, so the exact identifiers in PLAN.md §3 stay in exactly one place.
 */

export interface NamingContext {
  /** Deployment stage, e.g. "dev" or "prod" (CDK context `stage`, default "dev"). */
  readonly stage: string;
  /** AWS account id, used only to make bucket names globally unique. */
  readonly account: string;
}

/** Builds a `Naming` helper bound to one stack's stage/account. */
export function createNaming(context: NamingContext): Naming {
  return new Naming(context);
}

export class Naming {
  constructor(private readonly context: NamingContext) {}

  /** `docintel-uploads-<acct>` per PLAN.md §3 (S3 bucket names must be globally unique). */
  get uploadsBucket(): string {
    return `docintel-uploads-${this.context.account}`;
  }

  /** `docintel-web-<acct>` per PLAN.md §3. */
  get webBucket(): string {
    return `docintel-web-${this.context.account}`;
  }

  /** `docintel-jobs` for the default "dev" stage; `docintel-jobs-<stage>` otherwise. */
  get jobsTable(): string {
    return this.stageSuffixed('docintel-jobs');
  }

  /** Secrets Manager secret name for the Databricks placeholder credentials. */
  get databricksSecret(): string {
    return 'docintel/databricks';
  }

  /** Secrets Manager secret name for the AWS MCP (Cognito) credentials handed to Databricks. */
  get awsMcpSecret(): string {
    return 'docintel/aws-mcp';
  }

  /** Cognito hosted-UI domain prefix — must be globally unique, so it includes the account id. */
  get cognitoDomainPrefix(): string {
    return `docintel-${this.context.account}`;
  }

  /** Cognito resource server id that owns the Gateway's `invoke` scope. */
  get gatewayResourceServerId(): string {
    return 'docintel-gw';
  }

  /** OAuth scope name (unqualified) granted to the Gateway's M2M client. */
  get gatewayScopeName(): string {
    return 'invoke';
  }

  /** AgentCore runtime name for the DOCX agent. */
  get docxRuntimeName(): string {
    return 'docintel_docx_agent';
  }

  /** AgentCore runtime name for the orchestrator agent. */
  get orchestratorRuntimeName(): string {
    return 'docintel_orchestrator';
  }

  /** Generic `docintel-<base>` name, stage-suffixed for non-dev stages. */
  resource(base: string): string {
    return this.stageSuffixed(`docintel-${base}`);
  }

  private stageSuffixed(base: string): string {
    return this.context.stage === 'dev' ? base : `${base}-${this.context.stage}`;
  }
}
