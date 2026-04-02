import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Fix artifact_studio -> artifact-studio
const [rows] = await conn.query('SELECT id FROM plugin_schemas WHERE id = ?', ['artifact-studio']);
if (rows.length === 0) {
  await conn.query('UPDATE plugin_schemas SET id = ? WHERE id = ?', ['artifact-studio', 'artifact_studio']);
  console.log('Fixed: artifact_studio -> artifact-studio');
} else {
  console.log('artifact-studio already exists');
}

// Ensure admin role can use all plugins
// allowedRoles may be stored as JSON array or comma-separated string
const [allPlugins] = await conn.query('SELECT id, allowedRoles FROM plugin_schemas');
for (const p of allPlugins) {
  let roles;
  try {
    roles = JSON.parse(p.allowedRoles);
  } catch {
    roles = p.allowedRoles.split(',').map(r => r.trim()).filter(Boolean);
  }
  if (!Array.isArray(roles)) roles = [roles];
  if (!roles.includes('admin')) {
    roles.push('admin');
    await conn.query('UPDATE plugin_schemas SET allowedRoles = ? WHERE id = ?', [JSON.stringify(roles), p.id]);
    console.log('Added admin to', p.id, 'roles:', roles);
  } else {
    console.log(p.id, 'already has admin role');
  }
}

const [plugins] = await conn.query('SELECT id, name, status, allowedRoles FROM plugin_schemas');
console.log('Current plugins:', plugins);

await conn.end();
