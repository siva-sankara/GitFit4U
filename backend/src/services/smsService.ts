import { env, isProduction } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
export async function sendOtpSms(phone:string,code:string):Promise<boolean>{
 if(!env.MSG91_AUTH_KEY||!env.MSG91_TEMPLATE_ID){if(isProduction)throw new AppError(503,"SMS_NOT_CONFIGURED","Phone verification is unavailable. Please sign in with your password.");return false;}
 const query=new URLSearchParams({template_id:env.MSG91_TEMPLATE_ID,mobile:phone.replace(/^\+/,""),otp:code,otp_length:"6",otp_expiry:"5"});
 try{const response=await fetch(`https://control.msg91.com/api/v5/otp?${query}`,{method:"POST",headers:{authkey:env.MSG91_AUTH_KEY,"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(10000)});const result=await response.json() as {type?:string};if(!response.ok||result.type!=="success")throw new Error("Provider rejected request");return true;}catch{throw new AppError(502,"SMS_DELIVERY_FAILED","The verification code could not be sent. Please try again later.");}
}
