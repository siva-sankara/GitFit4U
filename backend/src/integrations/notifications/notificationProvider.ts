export interface PushMessage { token:string; title:string; body:string; data?:Record<string,string>; }
export interface NotificationProvider { send(message:PushMessage):Promise<{providerMessageId:string}>; }
