import type { Disposable } from "@sern/handler";
import {
  auth,
  driver as createDriver,
  Driver,
  ManagedTransaction,
  Session,
} from "neo4j-driver";

export type AuthString = `${string}/${string}`;

export interface N4jClientOptions {
  ip: string;
  port: number;
  auth?: AuthString;
}

/**
 * Class to interact with a Neo4j Database.
 * This class is responsible for executing queries and managing session lifecycles,
 * including a mechanism to reuse sessions and close them after a period of inactivity.
 * Class is never exposed to any higher level class instances like Neo4jFamilyMembers. This class only ever handles raw database data -
 * and is the bridge between the code and the database.
 */
export class N4jClient implements Disposable {
  private static readonly defaultOptions: N4jClientOptions = {
    ip: "localhost",
    port: 7687,
  };

  /**
   * Driver is stored as a member as the class cannot extend the driver due to neo4j constraints.
   */
  private driver: Driver;
  private session: Session | null = null;
  /**
   * The id of the currently set timeout (if one exists) to close the session.
   * This is used as the class automatically closes inactive sessions.
   */
  private sessionTimeoutId: NodeJS.Timeout | null = null;

  constructor(options: Partial<N4jClientOptions> = {}) {
    const mergedData = { ...N4jClient.defaultOptions, ...options };

    // Creating driver that the entire class will use
    this.driver = createDriver(
      this.createUrl(mergedData.ip, mergedData.port),
      auth.basic("neo4j", "9SouthernSkies"),
    );
  }

  public async test() {
    try {
      // Run a simple Cypher query to verify the connection
      const result = await this.runQuery(
        "RETURN 'Connection successful' AS message",
      );

      console.log(result.records[0].get("message")); // Should print: "Connection successful"

      console.log("✅ Connected to Neo4j successfully!");
    } catch (error) {
      console.error("❌ Failed to connect to Neo4j:", error);
    }
  }

  private async closeSession() {
    if (this.session) {
      await this.session.close();
      this.session = null;
    }
  }

  /**
   * Resets the current session timeout back to 30 seconds.
   */
  private resetSessionTimeout() {
    if (this.sessionTimeoutId) {
      clearTimeout(this.sessionTimeoutId);
    }
    this.sessionTimeoutId = setTimeout(
      () => this.closeSession(),
      30_000,
    ) as NodeJS.Timeout;
  }

  /**
   * Ensures that a session is open. If no session is open, a new one is created.
   * Resets the session inactivity timeout on each call to prevent premature closing.
   */
  private ensureSession() {
    if (!this.session) {
      this.session = this.driver.session();
    }
    this.resetSessionTimeout();
  }

  /**
   * Executes a Cypher query against the Neo4j database using the current session.
   */
  public async runQuery(query: string, parameters: Record<string, any> = {}) {
    this.ensureSession();

    let res;
    try {
      res = await this.session!.run(query, parameters);
    } catch (e) {
      throw new Error(`Error while executing cypher query: ${e}`);
    }

    return res;
  }

  /**
   * Creates a transaction and executes it against the database using the current session.
   *
   * By default uses a write transaction, change "transactionType" paramter to "read" alternatively.
   */
  public async createTransaction(
    transactionFunc: (t: ManagedTransaction) => any,
    transactionType: "write" | "read" = "write",
  ) {
    this.ensureSession();

    let res;
    try {
      if (transactionType === "write") {
        res = await this.session!.executeWrite(transactionFunc);
      } else {
        res = await this.session!.executeRead(transactionFunc);
      }
    } catch (e) {
      throw new Error(`Error while executing neo4j transaction: ${e}`);
    }

    return res;
  }

  /**
   * Deconstruct method. Should be automatically called by sern upon client crash or close.
   */
  public async dispose() {
    if (this.session) {
      await this.session.close();
    }
    if (this.sessionTimeoutId) {
      this.sessionTimeoutId = null;
    }
    await this.driver.close();
  }

  /**
   * Creates a new n4j url.
   */
  private createUrl(ip: string, port: number) {
    return `bolt://${ip}:${port}`;
  }
}
