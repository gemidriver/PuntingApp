export type Selection = {
  meetId?: string;
  meetCourse?: string;
  raceId: string;
  raceName: string;
  horseId: string;
  horseName: string;
};
export interface ProfileRecord {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
}
