import assert from 'node:assert/strict';
import { sanitizeDataType, parseStructFields, expandStructFields } from './metadata';

// sanitizeDataType

assert.equal(sanitizeDataType('STRUCT(given VARCHAR, family VARCHAR)'), 'STRUCT');
assert.equal(sanitizeDataType('MAP(VARCHAR, VARCHAR)'), 'MAP');
assert.equal(sanitizeDataType("ENUM('a','b','c')"), 'ENUM');
assert.equal(sanitizeDataType('STRUCT(name VARCHAR, ext MAP(VARCHAR, VARCHAR))'), 'STRUCT');
assert.equal(sanitizeDataType('DECIMAL(8,2)'), 'DECIMAL(8_2)');
assert.equal(sanitizeDataType('NUMERIC(10,4)'), 'NUMERIC(10_4)');
assert.equal(sanitizeDataType('VARCHAR'), 'VARCHAR');
assert.equal(sanitizeDataType('TIMESTAMP'), 'TIMESTAMP');
assert.equal(sanitizeDataType('BOOLEAN'), 'BOOLEAN');
assert.equal(sanitizeDataType('VARCHAR[]'), 'VARCHAR[]');

// parseStructFields

const simple = parseStructFields('STRUCT(given VARCHAR, family VARCHAR)');
assert.equal(simple.length, 2);
assert.deepEqual(simple[0], { name: 'given', type: 'VARCHAR' });
assert.deepEqual(simple[1], { name: 'family', type: 'VARCHAR' });

const quoted = parseStructFields('STRUCT(given VARCHAR, "family" VARCHAR)');
assert.equal(quoted[1].name, 'family');

const nestedMap = parseStructFields('STRUCT(name VARCHAR, ext MAP(VARCHAR, VARCHAR))');
assert.equal(nestedMap.length, 2);
assert.deepEqual(nestedMap[1], { name: 'ext', type: 'MAP(VARCHAR, VARCHAR)' });

const nestedStruct = parseStructFields('STRUCT(name STRUCT(first VARCHAR, last VARCHAR), age INTEGER)');
assert.equal(nestedStruct.length, 2);
assert.deepEqual(nestedStruct[0], { name: 'name', type: 'STRUCT(first VARCHAR, last VARCHAR)' });

assert.deepEqual(parseStructFields('VARCHAR'), []);
assert.deepEqual(parseStructFields('MAP(VARCHAR, VARCHAR)'), []);

// expandStructFields

const flat = expandStructFields('full_name', 'STRUCT(given VARCHAR, family VARCHAR)');
assert.deepEqual(flat, [
  { name: 'full_name__given', type: 'VARCHAR' },
  { name: 'full_name__family', type: 'VARCHAR' },
]);

const nested = expandStructFields('contact', 'STRUCT(email VARCHAR, address STRUCT(street VARCHAR, city VARCHAR, country VARCHAR))');
assert.deepEqual(nested, [
  { name: 'contact__email', type: 'VARCHAR' },
  { name: 'contact__address__street', type: 'VARCHAR' },
  { name: 'contact__address__city', type: 'VARCHAR' },
  { name: 'contact__address__country', type: 'VARCHAR' },
]);

assert.deepEqual(expandStructFields('price', 'DECIMAL(8,2)'), []);

console.log('All tests passed.');
