export type Role = "USER" | "GYM_OWNER" | "TRAINER" | "ADMIN";

export interface Gym {
  id: string;
  slug: string;
  name: string;
  area: string;
  city: string;
  distance: number;
  rating: number;
  reviews: number;
  price: number;
  status: "Open" | "Closed";
  verified: boolean;
  facilities: string[];
  image: string;
  accent: string;
}

export interface Member {
  id: string;
  name: string;
  initials: string;
  phone: string;
  plan: string;
  expires: string;
  status: "Active" | "Expiring" | "Expired" | "Suspended";
  attendance: number;
  payment: "Paid" | "Due" | "Failed";
}

export interface Registration {
  id: string;
  gym: string;
  owner: string;
  city: string;
  submitted: string;
  status: "Verification pending" | "Final approval" | "Changes required";
  completion: number;
}
