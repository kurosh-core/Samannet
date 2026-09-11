// استفاده: node scripts/make-admin.js user@example.com
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("استفاده: node scripts/make-admin.js user@example.com");
    process.exit(1);
  }
  const user = await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
  console.log(`کاربر ${user.email} اکنون ADMIN است.`);
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
