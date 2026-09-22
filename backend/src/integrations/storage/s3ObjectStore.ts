import crypto from "node:crypto"; import { env } from "../../config/env.js"; import { AppError } from "../../utils/AppError.js";
const h=(key:Buffer|string,value:string)=>crypto.createHmac("sha256",key).update(value).digest(); const hex=(value:string)=>crypto.createHash("sha256").update(value).digest("hex");
function encodePath(value:string){return value.split("/").map(encodeURIComponent).join("/");}
export function presignedObjectUrl(method:"PUT"|"GET"|"HEAD"|"DELETE",key:string,expires=900){
  if(!env.OBJECT_STORAGE_ENDPOINT||!env.OBJECT_STORAGE_ACCESS_KEY||!env.OBJECT_STORAGE_SECRET_KEY)throw new AppError(503,"OBJECT_STORAGE_NOT_CONFIGURED","File storage is not configured.");
  const endpoint=new URL(env.OBJECT_STORAGE_ENDPOINT),now=new Date(),date=now.toISOString().replace(/[:-]|\.\d{3}/g,"").slice(0,15)+"Z",day=date.slice(0,8),region=env.OBJECT_STORAGE_REGION,service="s3",scope=`${day}/${region}/${service}/aws4_request`,path=`/${encodeURIComponent(env.OBJECT_STORAGE_BUCKET)}/${encodePath(key)}`;
  const params=new URLSearchParams({"X-Amz-Algorithm":"AWS4-HMAC-SHA256","X-Amz-Credential":`${env.OBJECT_STORAGE_ACCESS_KEY}/${scope}`,"X-Amz-Date":date,"X-Amz-Expires":String(expires),"X-Amz-SignedHeaders":"host"}); params.sort();
  const canonical=`${method}\n${path}\n${params.toString()}\nhost:${endpoint.host}\n\nhost\nUNSIGNED-PAYLOAD`,stringToSign=`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hex(canonical)}`;
  const signing=h(h(h(h(`AWS4${env.OBJECT_STORAGE_SECRET_KEY}`,day),region),service),"aws4_request"),signature=crypto.createHmac("sha256",signing).update(stringToSign).digest("hex");params.set("X-Amz-Signature",signature);return `${endpoint.origin}${path}?${params}`;
}
