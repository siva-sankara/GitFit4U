import type { Gym, Member, Registration } from "../types";

export const gyms: Gym[] = [
  {
    id: "forge",
    slug: "forge-fitness-kondapur",
    name: "Forge Fitness",
    area: "Kondapur",
    city: "Hyderabad",
    distance: 1.2,
    rating: 4.8,
    reviews: 328,
    price: 1499,
    status: "Open",
    verified: true,
    facilities: ["Strength", "Cardio", "Personal training", "Parking"],
    image: "/assets/gym-community-hero.webp",
    accent: "#b9ff66"
  },
  {
    id: "pulse",
    slug: "pulse-athletic-club",
    name: "Pulse Athletic Club",
    area: "Gachibowli",
    city: "Hyderabad",
    distance: 2.4,
    rating: 4.7,
    reviews: 216,
    price: 1799,
    status: "Open",
    verified: true,
    facilities: ["HIIT", "Zumba", "Yoga", "Showers"],
    image: "/assets/strength-card.webp",
    accent: "#52e5c4"
  },
  {
    id: "apex",
    slug: "apex-performance-studio",
    name: "Apex Performance",
    area: "Madhapur",
    city: "Hyderabad",
    distance: 3.1,
    rating: 4.6,
    reviews: 184,
    price: 1299,
    status: "Open",
    verified: true,
    facilities: ["CrossFit", "Mobility", "Locker rooms"],
    image: "/assets/gym-community-hero.webp",
    accent: "#ffb866"
  },
  {
    id: "zen",
    slug: "zenfit-wellness",
    name: "ZenFit Wellness",
    area: "Jubilee Hills",
    city: "Hyderabad",
    distance: 5.8,
    rating: 4.5,
    reviews: 142,
    price: 1999,
    status: "Closed",
    verified: true,
    facilities: ["Yoga", "Pilates", "Nutrition", "Spa"],
    image: "/assets/strength-card.webp",
    accent: "#c3a8ff"
  }
];

export const members: Member[] = [
  { id: "GFU-24018", name: "Rohan Sharma", initials: "RS", phone: "+91 98765 43210", plan: "Unlimited Monthly", expires: "24 Sep 2026", status: "Active", attendance: 18, payment: "Paid" },
  { id: "GFU-24019", name: "Ananya Reddy", initials: "AR", phone: "+91 91234 56780", plan: "Quarterly Pro", expires: "08 Sep 2026", status: "Expiring", attendance: 22, payment: "Paid" },
  { id: "GFU-24020", name: "Vikram Iyer", initials: "VI", phone: "+91 99887 76655", plan: "Unlimited Monthly", expires: "01 Sep 2026", status: "Expired", attendance: 9, payment: "Due" },
  { id: "GFU-24021", name: "Sara Khan", initials: "SK", phone: "+91 90000 11442", plan: "Annual Elite", expires: "18 May 2027", status: "Active", attendance: 26, payment: "Paid" },
  { id: "GFU-24022", name: "Aditya Rao", initials: "AD", phone: "+91 94444 55331", plan: "Weekend Flex", expires: "14 Oct 2026", status: "Suspended", attendance: 7, payment: "Failed" }
];

export const registrations: Registration[] = [
  { id: "REG-1082", gym: "Evolve Fitness Lab", owner: "Kavya Menon", city: "Bengaluru", submitted: "Today, 09:42", status: "Verification pending", completion: 96 },
  { id: "REG-1081", gym: "Iron District", owner: "Nikhil Verma", city: "Pune", submitted: "Yesterday", status: "Final approval", completion: 100 },
  { id: "REG-1079", gym: "Core 360", owner: "Ishita Das", city: "Chennai", submitted: "2 Sep 2026", status: "Changes required", completion: 82 }
];

export const revenueSeries = [
  { month: "Apr", value: 540000 },
  { month: "May", value: 680000 },
  { month: "Jun", value: 620000 },
  { month: "Jul", value: 810000 },
  { month: "Aug", value: 920000 },
  { month: "Sep", value: 1040000 }
];

export const attendanceSeries = [
  { day: "Mon", visits: 128 },
  { day: "Tue", visits: 146 },
  { day: "Wed", visits: 138 },
  { day: "Thu", visits: 172 },
  { day: "Fri", visits: 164 },
  { day: "Sat", visits: 198 },
  { day: "Sun", visits: 96 }
];
