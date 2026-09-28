import { nanoid } from "nanoid";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { RoleAssignment } from "../models/Auth.js";
import { MemberProfile } from "../models/Member.js";
import { MembershipPlan, PlatformPlan, Subscription } from "../models/Commerce.js";
import { OWNER_DEFAULT_PERMISSIONS, TRAINER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { AuthIdentity } from "../models/Auth.js";
import { Trainer } from "../models/Engagement.js";
import bcrypt from "bcrypt";
import { isProduction } from "../config/env.js";

async function seed() {
  if (isProduction) throw new Error("Demo seeding is disabled in production.");
  await connectDatabase();

  const admin = await User.findOneAndUpdate(
    { email: "admin@getfit4u.in" },
    { $set: { publicId: "admin-demo", name: "Aarav Admin", roles: ["ADMIN"], activeRole: "ADMIN", status: "ACTIVE" } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  const owner = await User.findOneAndUpdate(
    { phone: "+919999000001" },
    { $set: { publicId: "owner-demo", name: "Meera Kapoor", roles: ["GYM_OWNER"], activeRole: "GYM_OWNER", status: "ACTIVE" } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  const memberUser = await User.findOneAndUpdate(
    { phone: "+919999000002" },
    { $set: { publicId: "member-demo", name: "Rohan Sharma", roles: ["USER"], activeRole: "USER", status: "ACTIVE" } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  const trainerUser = await User.findOneAndUpdate({ email: "trainer@getfit4u.in" }, { $set: { publicId: "trainer-demo", name: "Arjun Verma", roles: ["TRAINER"], activeRole: "TRAINER", status: "ACTIVE" } }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });

  const gym = await Gym.findOneAndUpdate(
    { slug: "forge-fitness-kondapur" },
    {
      $set: {
        publicId: "gym-forge-demo",
        ownerId: owner._id,
        name: "Forge Fitness",
        description: "A premium strength, functional training and recovery studio in Kondapur.",
        coverImageUrl: "/assets/gym-community-hero.png",
        facilities: ["Strength Training", "Cardio", "Personal Training", "Parking", "Locker Rooms"],
        amenities: ["Showers", "Filtered Water", "Wi-Fi"],
        gymType: ["Strength", "Functional"],
        contact: { phone: "+914012345678", email: "hello@forgefitness.example", whatsapp: "+919876543210" },
        address: { line1: "Botanical Garden Road", locality: "Kondapur", city: "Hyderabad", state: "Telangana", postalCode: "500084", country: "IN" },
        location: { type: "Point", coordinates: [78.3489, 17.4698] },
        timezone: "Asia/Kolkata",
        status: "ACTIVE",
        verificationStatus: "VERIFIED",
        platformSubscriptionStatus: "ACTIVE",
        profileCompleteness: 100,
        rating: { average: 4.8, count: 328 },
        startingPriceMinor: 149900,
        currency: "INR",
        publishedAt: new Date()
      }
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  await RoleAssignment.findOneAndUpdate(
    { userId: owner._id, role: "GYM_OWNER", gymId: gym._id },
    { permissions: OWNER_DEFAULT_PERMISSIONS, status: "ACTIVE" },
    { upsert: true }
  );
  await RoleAssignment.findOneAndUpdate(
    { userId: admin._id, role: "ADMIN", gymId: null },
    { permissions: ["admin:platform"], status: "ACTIVE" },
    { upsert: true }
  );
  await RoleAssignment.findOneAndUpdate({ userId: trainerUser._id, role:"TRAINER", gymId:gym._id }, { permissions:TRAINER_DEFAULT_PERMISSIONS,status:"ACTIVE" }, { upsert:true });
  await Trainer.findOneAndUpdate({ gymId:gym._id,userId:trainerUser._id }, { $set:{ publicId:"trainer-arjun-demo",name:"Arjun Verma",qualifications:["Certified Personal Trainer"],specializations:["Strength","HIIT"],status:"ACTIVE" } }, { upsert:true,returnDocument: "after",setDefaultsOnInsert:true });
  const passwordHash=await bcrypt.hash("GetFit4U123",12);
  for (const [user,subject] of [[admin,"admin@getfit4u.in"],[trainerUser,"trainer@getfit4u.in"]] as const) await AuthIdentity.findOneAndUpdate({ userId:user._id,provider:"PASSWORD" }, { $set:{ providerSubject:subject,verifiedAt:new Date(),passwordHash } }, { upsert:true,returnDocument: "after" });

  const plan = await MembershipPlan.findOneAndUpdate(
    { gymId: gym._id, code: "UNLIMITED-MONTHLY", version: 1 },
    {
      $set: {
        publicId: "plan-unlimited-demo",
        name: "Unlimited Monthly",
        description: "Unlimited gym access and group classes.",
        durationDays: 30,
        priceMinor: 149900,
        discountMinor: 0,
        taxRateBasisPoints: 1800,
        currency: "INR",
        benefits: ["Unlimited gym access", "Group classes", "Fitness assessment"],
        freezeDaysAllowed: 3,
        status: "ACTIVE"
      }
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  const member = await MemberProfile.findOneAndUpdate(
    { gymId: gym._id, userId: memberUser._id },
    { $set: { publicId: "member-rohan-demo", memberCode: "GFU-24018", status: "ACTIVE", fitnessGoal: "Build strength" } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() - 8);
  const endsAt = new Date(startsAt);
  endsAt.setDate(endsAt.getDate() + 30);
  const subscription = await Subscription.findOneAndUpdate(
    { memberProfileId: member._id, status: "ACTIVE" },
    {
      $set: {
        publicId: "subscription-rohan-demo",
        type: "GYM_MEMBERSHIP",
        userId: memberUser._id,
        gymId: gym._id,
        planSnapshot: { planId: plan.publicId, name: plan.name, durationDays: plan.durationDays, priceMinor: plan.priceMinor },
        startsAt,
        endsAt,
        renewalAt: endsAt
      }
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  member.currentSubscriptionId = subscription._id;
  await member.save();

  await PlatformPlan.updateOne(
    { code: "GROWTH", version: 1 },
    { $setOnInsert: { name: "Growth", billingPeriod: "MONTHLY", priceMinor: 199900, currency: "INR", memberLimit: 500, staffLimit: 8, features: ["Attendance scanner", "Campaigns", "Advanced reports"], active: true } },
    { upsert: true }
  );

  console.info(`Seeded GETFIT4U demo: ${gym.name} (${nanoid(4)})`);
  await disconnectDatabase();
}

seed().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
