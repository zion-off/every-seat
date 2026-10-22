import { personKey } from "../lens.js";
import { loadSeed, personSchema } from "./seed.js";

/** @typedef {import("../contracts.d.ts").LensPerson} LensPerson */
/** @typedef {import("../contracts.d.ts").LensMessage} LensMessage */
/** @typedef {import("./index.js").PreferenceStore} PreferenceStore */
/** @typedef {import("./seed.js").Seed} Seed */

const TONIGHT = "tonight";

/** @param {string} key */
const personItem = (key) => `person#${key}`;

/**
 * Keeps saved settings in one DynamoDB table with the household as the partition key
 * (`household`, string) and the item as the sort key (`item`, string): `person#<name>`
 * holds a person's settings, `tonight` holds the last lens. The seed file supplies the
 * people a household starts with; saved items win over it. The table must already exist.
 *
 * @implements {PreferenceStore}
 */
export class DynamoStore {
  /**
   * @param {import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient} client
   * @param {typeof import("@aws-sdk/lib-dynamodb")} sdk
   * @param {string} table
   * @param {Seed} seed
   */
  constructor(client, sdk, table, seed) {
    this.client = client;
    this.sdk = sdk;
    this.table = table;
    this.seed = seed;
  }

  /**
   * The AWS SDK is an optional dependency, so it is only loaded when this store is chosen.
   * @param {{ table: string, region: string, endpoint?: string, seedFile: string }} options
   */
  static async create({ table, region, endpoint, seedFile }) {
    /** @type {[typeof import("@aws-sdk/client-dynamodb"), typeof import("@aws-sdk/lib-dynamodb")]} */
    let sdks;
    try {
      sdks = await Promise.all([import("@aws-sdk/client-dynamodb"), import("@aws-sdk/lib-dynamodb")]);
    } catch (error) {
      throw new Error("the DynamoDB store needs @aws-sdk/client-dynamodb and @aws-sdk/lib-dynamodb installed", {
        cause: error,
      });
    }
    const [{ DynamoDBClient }, lib] = sdks;
    const base = new DynamoDBClient({
      region,
      ...(endpoint ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } } : {}),
    });
    const client = lib.DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
    return new DynamoStore(client, lib, table, await loadSeed(seedFile));
  }

  /** @param {string} household */
  async listPeople(household) {
    /** @type {Map<string, LensPerson>} */
    const people = new Map();
    for (const person of this.seed[household]?.people ?? []) people.set(personKey(person.name), person);

    /** @type {Record<string, unknown> | undefined} */
    let startKey;
    do {
      const page = await this.client.send(
        new this.sdk.QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "household = :household AND begins_with(#item, :prefix)",
          ExpressionAttributeNames: { "#item": "item" },
          ExpressionAttributeValues: { ":household": household, ":prefix": "person#" },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const row of page.Items ?? []) {
        const person = personSchema.parse({ name: row.name, settings: row.settings });
        people.set(personKey(person.name), person);
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);

    return [...people.values()];
  }

  /**
   * @param {string} household
   * @param {string} name
   */
  async getPerson(household, name) {
    const key = personKey(name);
    const { Item } = await this.client.send(
      new this.sdk.GetCommand({ TableName: this.table, Key: { household, item: personItem(key) } }),
    );
    if (Item) return personSchema.parse({ name: Item.name, settings: Item.settings });
    return this.seed[household]?.people.find((person) => personKey(person.name) === key);
  }

  /**
   * @param {string} household
   * @param {LensPerson} person
   */
  async savePerson(household, person) {
    await this.client.send(
      new this.sdk.PutCommand({
        TableName: this.table,
        Item: {
          household,
          item: personItem(personKey(person.name)),
          name: person.name,
          settings: person.settings,
        },
      }),
    );
  }

  /** @param {string} household */
  async getTonight(household) {
    const { Item } = await this.client.send(
      new this.sdk.GetCommand({ TableName: this.table, Key: { household, item: TONIGHT } }),
    );
    return /** @type {LensMessage | undefined} */ (Item?.lens);
  }

  /**
   * @param {string} household
   * @param {LensMessage} lens
   */
  async saveTonight(household, lens) {
    await this.client.send(
      new this.sdk.PutCommand({ TableName: this.table, Item: { household, item: TONIGHT, lens } }),
    );
  }
}
