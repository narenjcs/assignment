/**
 * Centralized resource-name computation (DEVELOPMENT.md §3: "no hard-coded names except via
 * a naming.ts helper"). Every other construct asks `Naming` for a name instead of writing a
 * literal string, so the exact identifiers in PLAN.md §3 stay in exactly one place.
 *
 * Every globally-unique or otherwise stage-sensitive name below is stage-suffixed (review round
 * 1, item 3): without this, `-c stage=prod` synth/deploy would resolve to the exact same S3
 * bucket, Secrets Manager secret, Cognito domain, and AgentCore runtime names as the default
 * "dev" stage, so a prod deploy could silently replace or destroy dev resources (or vice versa)
 * instead of failing to create them because they already exist.
 */

/** Runtime names must match `[a-zA-Z][a-zA-Z0-9_]{0,47}` — no hyphens, 48 chars max. */
const RUNTIME_NAME_MAX_LENGTH = 48;

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

  /** `docintel-uploads-<acct>` for "dev"; `docintel-uploads-<acct>-<stage>` otherwise. */
  get uploadsBucket(): string {
    return this.stageSuffixed(`docintel-uploads-${this.context.account}`);
  }

  /** `docintel-web-<acct>` for "dev"; `docintel-web-<acct>-<stage>` otherwise. */
  get webBucket(): string {
    return this.stageSuffixed(`docintel-web-${this.context.account}`);
  }

  /** `docintel-jobs` for the default "dev" stage; `docintel-jobs-<stage>` otherwise. */
  get jobsTable(): string {
    return this.stageSuffixed('docintel-jobs');
  }

  /** Secrets Manager secret name for the Databricks placeholder credentials. */
  get databricksSecret(): string {
    return this.stageSuffixed('docintel/databricks');
  }

  /** Secrets Manager secret name for the AWS MCP (Cognito) credentials handed to Databricks. */
  get awsMcpSecret(): string {
    return this.stageSuffixed('docintel/aws-mcp');
  }

  /** Cognito hosted-UI domain prefix — must be globally unique, so it includes the account id. */
  get cognitoDomainPrefix(): string {
    return this.stageSuffixed(`docintel-${this.context.account}`);
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
    return this.runtimeNameSuffixed('docintel_docx_agent');
  }

  /** AgentCore runtime name for the orchestrator agent. */
  get orchestratorRuntimeName(): string {
    return this.runtimeNameSuffixed('docintel_orchestrator');
  }

  /** Generic `docintel-<base>` name, stage-suffixed for non-dev stages. */
  resource(base: string): string {
    return this.stageSuffixed(`docintel-${base}`);
  }

  private stageSuffixed(base: string): string {
    return this.context.stage === 'dev' ? base : `${base}-${this.context.stage}`;
  }

  /**
   * Same stage-suffixing as `stageSuffixed`, but for AgentCore runtime names, which forbid
   * hyphens and cap out at 48 characters (`[a-zA-Z][a-zA-Z0-9_]{0,47}`): the stage is sanitized
   * to that charset and joined with `_`, then the whole name is truncated to fit.
   */
  private runtimeNameSuffixed(base: string): string {
    if (this.context.stage === 'dev') {
      return base;
    }
    const safeStage = this.context.stage.replace(/[^a-zA-Z0-9_]/g, '_');
    return `${base}_${safeStage}`.slice(0, RUNTIME_NAME_MAX_LENGTH);
  }
}
