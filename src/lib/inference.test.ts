import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferRelationships, INFERRED_RELATIONSHIPS_COMMENT } from './inference';
import { generateMermaidCodeForAllDBs, type Metadata, type Table } from './metadata';

const table = (name: string, columns: Record<string, string>, schemaName = 'main', databaseName = 'db'): Table => ({
  name, databaseName, schemaName, hasPrimaryKey: false, estimatedRowCount: 0,
  columnCount: Object.keys(columns).length, indexCount: 0, checkConstraintCount: 0, sql: '', constraints: [],
  columns: Object.entries(columns).map(([name, dataType]) => ({ name, dataType, precision: 0, scale: 0, isNullable: true })),
});

const metadata = (...tables: Table[]): Metadata => {
  const databases: NonNullable<Metadata['databases']> = [];
  for (const table of tables) {
    let database = databases.find(db => db.name === table.databaseName);
    if (!database) databases.push(database = { name: table.databaseName!, schemas: [] });
    let schema = database.schemas!.find(schema => schema.name === table.schemaName);
    if (!schema) database.schemas!.push(schema = { name: table.schemaName!, tables: [] });
    schema.tables!.push(table);
  }
  return { databases };
};

test('inference matches same-name _id columns case-insensitively without primary keys', () => {
  const orders = table('orders', { ORDER_ID: 'INTEGER' });
  const lineitem = table('lineitem', { order_id: 'INTEGER' });
  assert.deepEqual(inferRelationships([orders, lineitem]), [{ left: lineitem, right: orders, columns: ['order_id'] }]);
});

test('default inference ignores ordinary names, different names, and different full datatypes', () => {
  const a = table('a', {
    id: 'INTEGER', status: 'VARCHAR', order_key: 'INTEGER', customer_id: 'INTEGER', order_id: 'INTEGER',
    price_id: 'DECIMAL(8,2)', status_id: "ENUM('active', 'inactive')", data_id: 'STRUCT(value INTEGER)',
  });
  const b = table('b', {
    id: 'INTEGER', status: 'VARCHAR', order_key: 'INTEGER', team_id: 'INTEGER', order_id: 'BIGINT',
    price_id: 'DECIMAL(10,2)', status_id: "ENUM('Active', 'inactive')", data_id: 'STRUCT(value VARCHAR)',
  });
  assert.deepEqual(inferRelationships([a, b]), []);
});

test('custom regex replaces the suffix filter without mapping different column names', () => {
  const a = table('a', { order_id: 'INTEGER', order_key: 'INTEGER', status: 'VARCHAR' });
  const b = table('b', { order_id: 'INTEGER', ORDER_KEY: 'INTEGER', status: 'VARCHAR' });
  assert.deepEqual(inferRelationships([a, b], /_key$/i)[0].columns, ['order_key']);
  assert.deepEqual(inferRelationships([a, b], /(_id|_key)$/i)[0].columns, ['order_id', 'order_key']);
  assert.deepEqual(inferRelationships([a, b], /^status$/i)[0].columns, ['status']);
  assert.deepEqual(inferRelationships([a, b], /.*/i)[0].columns, ['order_id', 'order_key', 'status']);
  assert.deepEqual(inferRelationships([a, b], /^missing$/i), []);
  assert.deepEqual(inferRelationships([
    table('a', { order_id: 'INTEGER' }), table('b', { order_key: 'INTEGER' }),
  ], /^(order)_(id|key)$/i), []);
});

test('inference stays within one database and schema and does not create self-links', () => {
  const a = table('a', { order_id: 'INTEGER' });
  assert.deepEqual(inferRelationships([a, a]), []);
  assert.deepEqual(inferRelationships([
    a, table('b', { order_id: 'INTEGER' }, 'archive'), table('c', { order_id: 'INTEGER' }, 'main', 'other'),
  ]), []);
});

test('all unordered pairs are inferred once with sorted columns and stable ordering', () => {
  const tables = ['a', 'b', 'c'].map(name => table(name, { order_id: 'INTEGER', customer_id: 'INTEGER' }));
  const relationships = inferRelationships(tables);
  assert.deepEqual(relationships.map(({ left, right, columns }) => [left.name, right.name, columns]), [
    ['a', 'b', ['customer_id', 'order_id']],
    ['a', 'c', ['customer_id', 'order_id']],
    ['b', 'c', ['customer_id', 'order_id']],
  ]);
  assert.deepEqual(inferRelationships([...tables].reverse()), relationships);
  const pattern = /_id$/gi;
  pattern.lastIndex = 5;
  assert.deepEqual(inferRelationships(tables, pattern), relationships);
  assert.equal(pattern.lastIndex, 5, 'caller regex state is unchanged');
});

test('source generation is opt-in, annotates unknown edges, and does not add FK markers', () => {
  const data = metadata(table('orders', { order_id: 'INTEGER' }), table('lineitem', { order_id: 'INTEGER' }));
  const baseline = generateMermaidCodeForAllDBs(data)!;
  assert.doesNotMatch(baseline, /inferred|\.\.|\|\|/);
  assert.equal(generateMermaidCodeForAllDBs(data, false, false, /.*/i), baseline);
  const source = generateMermaidCodeForAllDBs(data, false, true)!;
  assert.ok(source.includes(INFERRED_RELATIONSHIPS_COMMENT));
  assert.match(source, /"db.lineitem" }o\.\.o\{ "db.orders" : "inferred: order_id \(unknown\)"/);
  assert.doesNotMatch(source, /\bFK\b/);
  assert.equal(generateMermaidCodeForAllDBs(data, false, true, /_key$/i), baseline);
});

test('any declared foreign key suppresses inference everywhere, including other schemas and databases', () => {
  const candidates = [table('orders', { order_id: 'INTEGER' }), table('lineitem', { order_id: 'INTEGER' })];
  for (const [schema, database] of [['archive', 'db'], ['main', 'other']]) {
    const child = table('child', { parent_id: 'INTEGER' }, schema, database);
    child.constraints = [{ columnName: 'parent_id', constraintType: 'FOREIGN KEY', sql: 'FOREIGN KEY (parent_id) REFERENCES parent(id)' }];
    const data = metadata(...candidates, table('parent', { id: 'INTEGER' }, schema, database), child);
    const baseline = generateMermaidCodeForAllDBs(data)!;
    assert.match(baseline, /\|\|--o\{/);
    assert.equal(generateMermaidCodeForAllDBs(data, false, true), baseline);
  }
});

test('inferred source qualifies colliding table names and retains unique names', () => {
  const data = metadata(
    table('orders', { order_id: 'INTEGER' }), table('lineitem', { order_id: 'INTEGER' }),
    table('orders', { order_id: 'INTEGER' }, 'archive'), table('lines', { order_id: 'INTEGER' }, 'archive'),
  );
  const source = generateMermaidCodeForAllDBs(data, false, true)!;
  for (const name of ['db.main.orders', 'db.archive.orders', 'db.lineitem', 'db.lines']) {
    assert.ok(source.includes(`"${name}" {`), name);
  }
  assert.match(source, /"db.lineitem" }o\.\.o\{ "db.main.orders"/);
  assert.match(source, /"db.lines" }o\.\.o\{ "db.archive.orders"/);
  assert.equal(source.match(/}o\.\.o\{/g)?.length, 2);
});

test('STRUCT expansion does not introduce inference candidates', () => {
  const data = metadata(table('a', { info: 'STRUCT(order_id INTEGER)' }), table('b', { info: 'STRUCT(order_id INTEGER)' }));
  const source = generateMermaidCodeForAllDBs(data, true, true)!;
  assert.match(source, /info__order_id/);
  assert.doesNotMatch(source, /inferred/);
  assert.equal(source, generateMermaidCodeForAllDBs(data, true));
});

test('empty metadata returns no diagram and table identities inherit their metadata scope', () => {
  for (const data of [{}, { databases: [] }, { databases: [{ name: 'empty', schemas: [] }] }]) {
    assert.equal(generateMermaidCodeForAllDBs(data, false, true), undefined);
  }
  const tables = [table('a', { order_id: 'INTEGER' }), table('b', { order_id: 'INTEGER' })];
  for (const table of tables) {
    delete table.databaseName;
    delete table.schemaName;
  }
  const data: Metadata = { databases: [
    { name: 'empty' }, { name: 'db', schemas: [{ name: 'main', tables }] },
  ] };
  assert.match(generateMermaidCodeForAllDBs(data, false, true)!, /"db.a" }o\.\.o\{ "db.b"/);
});
