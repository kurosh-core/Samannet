const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PLANS = [
  { name: "Free", maxConfigs: 3, maxUsers: 5, trafficLimitGb: 10, durationDays: 30, features: ["Basic Support"] },
  { name: "Basic", maxConfigs: 10, maxUsers: 25, trafficLimitGb: 50, durationDays: 30, features: ["Email Support"] },
  { name: "Pro", maxConfigs: 50, maxUsers: 200, trafficLimitGb: 500, durationDays: 30, features: ["Priority Support", "Cloudflare Integration"] },
  { name: "Business", maxConfigs: 500, maxUsers: 2000, trafficLimitGb: 5000, durationDays: 30, features: ["Dedicated Support", "Cloudflare Integration", "Custom Branding"] },
];

async function main() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: {},
      create: plan,
    });
  }
  console.log("Planهای پیش‌فرض ایجاد شدند: Free, Basic, Pro, Business");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
