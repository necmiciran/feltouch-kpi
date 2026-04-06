const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { openDb, initDb, isSeeded } = require("./db");

// seed.json is at project root (same dir as this file)
const seedPath = path.join(__dirname, "seed.json");

function main() {
  if (!fs.existsSync(seedPath)) {
    console.error("[seed] seed.json bulunamadı:", seedPath);
    process.exit(1);
  }

  const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
  const db = openDb();
  initDb(db);

  if (isSeeded(db)) {
    console.log("[seed] Veritabanı zaten dolu. Yeniden seed için: npm run reseed");
    return;
  }

  const insEmp = db.prepare(
    "INSERT INTO employees(code,name,title,design_center,net_salary,annual_bonus) VALUES (?,?,?,?,?,?)"
  );
  const insKpi = db.prepare(
    "INSERT INTO kpis(employee_code,kpi_no,title,weight,target_q1,target_q2,target_q3,target_q4) VALUES (?,?,?,?,?,?,?,?)"
  );
  const insGoal = db.prepare(`
    INSERT INTO goals(employee_code,category,topic,detail,kpi_no,measure_type,target_q1,target_q2,target_q3,target_q4)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  const insUser = db.prepare(
    "INSERT INTO users(username,password_hash,role,employee_code) VALUES (?,?,?,?)"
  );
  const upsertCfg = db.prepare(
    "INSERT INTO config(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json"
  );

  db.transaction(() => {
    for (const e of seed.employees) {
      insEmp.run(e.code, e.name, e.title, e.design_center ? 1 : 0, e.net_salary ?? null, e.annual_bonus ?? null);
    }
    for (const k of seed.kpis) {
      const t = k.targets || {};
      insKpi.run(k.employee_code, k.kpi_no, k.title, k.weight, t.Q1 ?? null, t.Q2 ?? null, t.Q3 ?? null, t.Q4 ?? null);
    }
    for (const g of seed.goals) {
      const t = g.targets || {};
      insGoal.run(
        g.employee_code, g.category || "", g.topic || "", g.detail || "",
        g.kpi_no ?? null, g.measure_type ?? null,
        t.Q1 ?? null, t.Q2 ?? null, t.Q3 ?? null, t.Q4 ?? null
      );
    }
    for (const u of seed.users) {
      const hash = bcrypt.hashSync(u.password, 10);
      insUser.run(u.username, hash, u.role, u.employee_code ?? null);
    }
    if (seed.manager_weights) {
      upsertCfg.run("manager_weights", JSON.stringify(seed.manager_weights));
    }
  })();

  console.log(`[seed] Tamamlandı. Çalışanlar=${seed.employees.length}, Hedefler=${seed.goals.length}`);
}

main();
