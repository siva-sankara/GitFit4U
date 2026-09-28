import { Navigate, useLocation } from "react-router-dom";

export const profileSections = ["overview", "personal", "membership", "bookings", "payments", "attendance", "workouts", "favorites", "referrals", "social", "settings"] as const;
export function ProfileSectionRedirect({ section }: { section: string }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("section", section);
  return <Navigate replace to={`/app/profile?${params}${location.hash}`} />;
}
