import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [r] = await conn.query('SELECT id, allowedRoles FROM plugin_schemas');
for (const p of r) {
  const v = p.allowedRoles;
  console.log(p.id, typeof v, Array.isArray(v), JSON.stringify(v));
  
  let roles = v;
  if (typeof roles === 'string') {
    try { roles = JSON.parse(roles); } catch { roles = roles.split(',').map(x => x.trim()); }
  }
  if (Array.isArray(roles) && roles.indexOf('admin') === -1) {
    roles.push('admin');
    await conn.query('UPDATE plugin_schemas SET allowedRoles = ? WHERE id = ?', [JSON.stringify(roles), p.id]);
    console.log('Updated', p.id, '->', JSON.stringify(roles));
  } else if (Array.isArray(roles)) {
    console.log(p.id, 'already has admin');
  }
}

const [final] = await conn.query('SELECT id, allowedRoles FROM plugin_schemas');
console.log('Final state:', JSON.stringify(final, null, 2));

await conn.end();
