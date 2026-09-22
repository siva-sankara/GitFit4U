import { DatabaseGymCard } from "../pages/live/LivePublic";
import type { Row } from "../pages/live/LiveData";
export function GymCard({gym}:{gym:Row;compact?:boolean}) { return <DatabaseGymCard gym={gym}/>; }
