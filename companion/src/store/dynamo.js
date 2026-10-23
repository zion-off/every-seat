import { personKey } from "../lens.js";
import { personSchema } from "./seed.js";

/** @typedef {import("../contracts.d.ts").LensPerson} LensPerson */
/** @typedef {import("../contracts.d.ts").LensMessage} LensMessage */
/** @typedef {import("./index.js").PreferenceStore} PreferenceStore */

const TONIGHT = "tonight";
const META = "meta";

/** @param {string} key */
const personItem = (key) => `person#${key}`;

/**
 * Keeps saved settings in one DynamoDB table with the household as the partition key
 * (`household`, string) and the item as the sort key (`item`, string): `person#<name>`
 * holds a person's settings, `tonight` holds the last lens and `meta` holds when the list
 * last changed. A household starts empty. The table must already exist.
 *
 * @implements {PreferenceStore}
 */
export class DynamoStore {
  /**
   * @param {import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient} client
   * @param {typeof import("@aws-sdk/lib-dynamodb")} sdk
   * @param {string} table
   */
  constructor(client, sdk, table) {
    this.client = client;
    this.sdk = sdk;
    this.table = table;
  }

  /**
   * The AWS SDK is an optional dependency, so it is only loaded when this store is chosen.
   * @param {{ table: string, region: string, endpoint?: string }} options
   */
  static async create({ table, region, endpoint }) {
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
    return new DynamoStore(client, lib, table);
  }

  /** @param {string} household */
  async listPeople(household) {
    /** @type {Map<string, LensPerson>} */
    const people = new Map();

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

  /** @param {string} household */
  async getHousehold(household) {
    const { Item } = await this.client.send(
      new this.sdk.GetCommand({ TableName: this.table, Key: { household, item: META } }),
    );
    return { people: await this.listPeople(household), updatedAt: Number(Item?.updatedAt ?? 0) };
  }

  /**
   * @param {string} household
   * @param {LensPerson[]} people
   * @param {number} updatedAt
   */
  async setHousehold(household, people, updatedAt) {
    const keep = new Set(people.map((person) => personKey(person.name)));
    for (const existing of await this.listPeople(household)) {
      if (keep.has(personKey(existing.name))) continue;
      await this.client.send(
        new this.sdk.DeleteCommand({
          TableName: this.table,
          Key: { household, item: personItem(personKey(existing.name)) },
        }),
      );
    }
    for (const person of people) await this.putPerson(household, person);
    await this.touch(household, updatedAt);
  }

  /**
   * @param {string} household
   * @param {number} updatedAt
   */
  async touch(household, updatedAt) {
    await this.client.send(
      new this.sdk.PutCommand({ TableName: this.table, Item: { household, item: META, updatedAt } }),
    );
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
    return undefined;
  }

  /**
   * @param {string} household
   * @param {LensPerson} person
   */
  async savePerson(household, person) {
    await this.putPerson(household, person);
    const { updatedAt } = await this.getHousehold(household);
    await this.touch(household, Math.max(Date.now(), updatedAt + 1));
  }

  /**
   * @param {string} household
   * @param {LensPerson} person
   */
  async putPerson(household, person) {
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
