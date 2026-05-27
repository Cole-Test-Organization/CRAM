#!/usr/bin/env node

// Dumps the live Postgres schema (public) to api/SCHEMA.md.
// Re-run after every migration. The DB is the source of truth.
//
//   npm --prefix api run db:schema
//   DATABASE_URL=... npm --prefix api run db:schema

import pg from 'pg';
import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'api', 'SCHEMA.md');

const connectionString =
  process.env.DATABASE_URL || 'postgres://crm:devpassword@localhost:5432/crm';

const SKIP_TABLES = new Set(['pgmigrations']);

const pool = new pg.Pool({ connectionString, max: 5 });

async function main() {
  const [serverVersion, dbName, tables, enums, views, policies, rls] =
    await Promise.all([
      pool.query('SHOW server_version').then((r) => r.rows[0].server_version),
      pool
        .query('SELECT current_database()')
        .then((r) => r.rows[0].current_database),
      fetchTables(),
      fetchEnums(),
      fetchViews(),
      fetchPolicies(),
      fetchRlsEnabled(),
    ]);

  const tableDetails = await Promise.all(
    tables.map(async (t) => ({
      ...t,
      columns: await fetchColumns(t.name),
      primaryKey: await fetchPrimaryKey(t.name),
      foreignKeys: await fetchForeignKeys(t.name),
      uniqueConstraints: await fetchUniqueConstraints(t.name),
      checkConstraints: await fetchCheckConstraints(t.name),
      indexes: await fetchIndexes(t.name),
      rls: rls.get(t.name) || { enabled: false, forced: false },
      policies: policies.filter((p) => p.tablename === t.name),
    })),
  );

  const md = renderMarkdown({
    serverVersion,
    dbName,
    tables: tableDetails,
    enums,
    views,
  });

  await writeFile(OUTPUT_PATH, md);
  await pool.end();
  console.log(
    `Wrote ${tableDetails.length} table(s), ${enums.length} enum(s), ${views.length} view(s) to ${OUTPUT_PATH}`,
  );
}

async function fetchTables() {
  const { rows } = await pool.query(`
    SELECT c.relname AS name,
           obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  return rows.filter((r) => !SKIP_TABLES.has(r.name));
}

async function fetchColumns(tableName) {
  const { rows } = await pool.query(
    `
    SELECT a.attname AS name,
           format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null,
           pg_get_expr(d.adbin, d.adrelid) AS default_value,
           col_description(a.attrelid, a.attnum) AS comment
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
    `,
    [`public.${tableName}`],
  );
  return rows;
}

async function fetchPrimaryKey(tableName) {
  const { rows } = await pool.query(
    `
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = $1::regclass AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
    `,
    [`public.${tableName}`],
  );
  return rows.map((r) => r.attname);
}

async function fetchForeignKeys(tableName) {
  const { rows } = await pool.query(
    `
    SELECT c.conname AS name,
           (SELECT json_agg(a.attname ORDER BY x.ord)
            FROM unnest(c.conkey) WITH ORDINALITY x(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS columns,
           ftn.nspname || '.' || ft.relname AS referenced_table,
           (SELECT json_agg(fa.attname ORDER BY x.ord)
            FROM unnest(c.confkey) WITH ORDINALITY x(attnum, ord)
            JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = x.attnum) AS referenced_columns,
           CASE c.confdeltype
             WHEN 'a' THEN 'NO ACTION'
             WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
           END AS on_delete
    FROM pg_constraint c
    JOIN pg_class ft ON ft.oid = c.confrelid
    JOIN pg_namespace ftn ON ftn.oid = ft.relnamespace
    WHERE c.conrelid = $1::regclass AND c.contype = 'f'
    ORDER BY c.conname
    `,
    [`public.${tableName}`],
  );
  return rows;
}

async function fetchUniqueConstraints(tableName) {
  const { rows } = await pool.query(
    `
    SELECT c.conname AS name,
           (SELECT json_agg(a.attname ORDER BY x.ord)
            FROM unnest(c.conkey) WITH ORDINALITY x(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS columns
    FROM pg_constraint c
    WHERE c.conrelid = $1::regclass AND c.contype = 'u'
    ORDER BY c.conname
    `,
    [`public.${tableName}`],
  );
  return rows;
}

async function fetchCheckConstraints(tableName) {
  const { rows } = await pool.query(
    `
    SELECT c.conname AS name,
           pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    WHERE c.conrelid = $1::regclass AND c.contype = 'c'
    ORDER BY c.conname
    `,
    [`public.${tableName}`],
  );
  return rows;
}

async function fetchIndexes(tableName) {
  const { rows } = await pool.query(
    `
    SELECT i.relname AS name,
           pg_get_indexdef(ix.indexrelid) AS definition,
           ix.indisunique AS is_unique
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE ix.indrelid = $1::regclass AND NOT ix.indisprimary
    ORDER BY i.relname
    `,
    [`public.${tableName}`],
  );
  return rows;
}

async function fetchEnums() {
  const { rows } = await pool.query(`
    SELECT t.typname AS name,
           json_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  `);
  return rows;
}

async function fetchViews() {
  const { rows } = await pool.query(`
    SELECT table_name AS name,
           view_definition AS definition
    FROM information_schema.views
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  return rows;
}

async function fetchPolicies() {
  const { rows } = await pool.query(`
    SELECT tablename,
           policyname,
           cmd,
           qual,
           with_check,
           permissive,
           to_json(roles) AS roles
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);
  return rows;
}

async function fetchRlsEnabled() {
  const { rows } = await pool.query(`
    SELECT relname,
           relrowsecurity AS enabled,
           relforcerowsecurity AS forced
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  `);
  return new Map(
    rows.map((r) => [r.relname, { enabled: r.enabled, forced: r.forced }]),
  );
}

function escapeMd(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMarkdown({ serverVersion, dbName, tables, enums, views }) {
  const out = [];
  out.push('# Database Schema');
  out.push('');
  out.push(
    '> Auto-generated by `npm --prefix api run db:schema` — do **not** edit by hand. Re-run after every migration so this file matches the live database.',
  );
  out.push('');
  out.push(`- **Database:** \`${dbName}\``);
  out.push(`- **Postgres:** ${serverVersion}`);
  out.push(`- **Generated:** ${new Date().toISOString()}`);
  out.push(`- **Tables:** ${tables.length}`);
  out.push(`- **Enums:** ${enums.length}`);
  out.push(`- **Views:** ${views.length}`);
  out.push('');
  out.push('---');
  out.push('');

  // Contents
  out.push('## Contents');
  out.push('');
  if (tables.length) {
    out.push('**Tables**');
    out.push('');
    for (const t of tables) {
      out.push(`- [\`${t.name}\`](#${t.name})`);
    }
    out.push('');
  }
  if (enums.length) {
    out.push('**Enums**');
    out.push('');
    for (const e of enums) {
      out.push(`- [\`${e.name}\`](#${e.name})`);
    }
    out.push('');
  }
  if (views.length) {
    out.push('**Views**');
    out.push('');
    for (const v of views) {
      out.push(`- [\`${v.name}\`](#${v.name})`);
    }
    out.push('');
  }
  out.push('---');
  out.push('');

  // Enums
  if (enums.length) {
    out.push('## Enums');
    out.push('');
    for (const e of enums) {
      out.push(`### \`${e.name}\``);
      out.push('');
      for (const v of e.values) out.push(`- \`${v}\``);
      out.push('');
    }
    out.push('---');
    out.push('');
  }

  // Tables
  if (tables.length) {
    out.push('## Tables');
    out.push('');
    for (const t of tables) {
      out.push(`### \`${t.name}\``);
      out.push('');
      if (t.comment) {
        out.push(`> ${escapeMd(t.comment)}`);
        out.push('');
      }

      out.push('| Column | Type | Nullable | Default | Notes |');
      out.push('|---|---|---|---|---|');
      for (const c of t.columns) {
        const isPk = t.primaryKey.includes(c.name);
        const notes = [];
        if (isPk) notes.push('**PK**');
        if (c.comment) notes.push(escapeMd(c.comment));
        out.push(
          `| \`${c.name}\` | \`${escapeMd(c.type)}\` | ${c.not_null ? 'NO' : 'YES'} | ${c.default_value ? '`' + escapeMd(c.default_value) + '`' : '—'} | ${notes.join('<br>')} |`,
        );
      }
      out.push('');

      if (t.primaryKey.length) {
        out.push(
          `**Primary key:** ${t.primaryKey.map((c) => '`' + c + '`').join(', ')}`,
        );
        out.push('');
      }

      if (t.uniqueConstraints.length) {
        out.push('**Unique constraints:**');
        out.push('');
        for (const u of t.uniqueConstraints) {
          out.push(
            `- \`${u.name}\`: (${u.columns.map((c) => '`' + c + '`').join(', ')})`,
          );
        }
        out.push('');
      }

      if (t.foreignKeys.length) {
        out.push('**Foreign keys:**');
        out.push('');
        for (const fk of t.foreignKeys) {
          const cols = fk.columns.map((c) => '`' + c + '`').join(', ');
          const refCols = fk.referenced_columns
            .map((c) => '`' + c + '`')
            .join(', ');
          out.push(
            `- ${cols} → \`${fk.referenced_table}\`(${refCols}) — ON DELETE ${fk.on_delete}`,
          );
        }
        out.push('');
      }

      if (t.checkConstraints.length) {
        out.push('**Check constraints:**');
        out.push('');
        for (const c of t.checkConstraints) {
          out.push(`- \`${c.name}\`: \`${escapeMd(c.definition)}\``);
        }
        out.push('');
      }

      if (t.indexes.length) {
        out.push('**Indexes:**');
        out.push('');
        for (const i of t.indexes) {
          out.push(
            `- \`${i.name}\`${i.is_unique ? ' *(unique)*' : ''} — \`${escapeMd(i.definition)}\``,
          );
        }
        out.push('');
      }

      if (t.rls.enabled) {
        out.push(
          `**Row-Level Security:** enabled${t.rls.forced ? ' (forced)' : ''}`,
        );
        out.push('');
        if (t.policies.length) {
          for (const p of t.policies) {
            out.push(
              `- \`${p.policyname}\` — ${p.cmd}, ${p.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}, roles: ${(p.roles || []).join(', ') || 'public'}`,
            );
            if (p.qual) out.push(`  - USING: \`${escapeMd(p.qual)}\``);
            if (p.with_check)
              out.push(`  - WITH CHECK: \`${escapeMd(p.with_check)}\``);
          }
          out.push('');
        }
      }

      out.push('---');
      out.push('');
    }
  }

  // Views
  if (views.length) {
    out.push('## Views');
    out.push('');
    for (const v of views) {
      out.push(`### \`${v.name}\``);
      out.push('');
      out.push('```sql');
      out.push(v.definition.trim());
      out.push('```');
      out.push('');
    }
  }

  return out.join('\n') + '\n';
}

main().catch((err) => {
  console.error('Failed to dump schema:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
