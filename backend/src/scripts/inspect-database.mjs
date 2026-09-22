import "dotenv/config";
import mongoose from "mongoose";
try {
 await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/getfit4u", { serverSelectionTimeoutMS:5000 });
 const collections=await mongoose.connection.db.listCollections({}, {nameOnly:true}).toArray();
 for(const c of collections) console.log(c.name+": "+await mongoose.connection.db.collection(c.name).estimatedDocumentCount());
 const hello=await mongoose.connection.db.admin().command({hello:1});
 console.log("Transactions supported: "+Boolean(hello.setName||hello.msg==="isdbgrid"));
} catch (error) {console.log("Database inspection failed: "+error.name+". Connection details withheld.");process.exitCode=1;} finally {await mongoose.disconnect();}
