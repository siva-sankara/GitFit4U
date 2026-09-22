import { MembershipPlan } from "../models/Commerce.js";
import { Review } from "../models/Engagement.js";
import { Gym } from "../models/Gym.js";
export async function refreshGymPrice(gymId:unknown){const plan=await MembershipPlan.findOne({gymId,status:"ACTIVE"}).sort({priceMinor:1}).select("priceMinor");await Gym.updateOne({_id:gymId},{$set:{startingPriceMinor:plan?.priceMinor||0}});}
export async function refreshGymRating(gymId:unknown){const stats=await Review.aggregate([{$match:{gymId,status:"PUBLISHED"}},{$group:{_id:null,average:{$avg:"$rating"},count:{$sum:1}}}]);await Gym.updateOne({_id:gymId},{$set:{rating:{average:stats[0]?.average||0,count:stats[0]?.count||0}}});}
