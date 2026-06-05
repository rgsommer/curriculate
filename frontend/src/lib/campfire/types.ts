// ============================================================
// Campfire Live — TypeScript Types
// ============================================================

export type EngagementType =
  | "poll"
  | "challenge"
  | "truth_or_dare"
  | "photo_pose"
  | "share"
  | "accountability"
  | "game"
  | "instant"
  | "anonymous_judge"
  | "guess"
  | "surprise"
  | "advice"
  | "voice_response";

export type EngagementStatus = "active" | "sealed" | "revealed" | "expired";
export type RevealMode = "sealed" | "all_at_once" | "first_in" | "as_they_come" | "instant";
export type MemberRole = "admin" | "member" | "spectator";

// ── Row types ──
export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  trial_ends_at: string;
  is_premium: boolean;
  stripe_customer_id: string | null;
  allow_random_guest: boolean;
  adult_content: boolean;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  creator_id: string;
  avatar_emoji: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
}

export interface Engagement {
  id: string;
  group_id: string;
  creator_id: string;
  type: EngagementType;
  title: string;
  description: string | null;
  config: Record<string, unknown>;
  deadline: string | null;
  reveal: RevealMode;
  is_blind: boolean;
  status: EngagementStatus;
  total_expected: number;
  recurrence_rule: string | null;
  parent_id: string | null;
  chain_next_creator_id: string | null;
  created_at: string;
  // Joined: the originator's display name (for "Name's Type" headers)
  creator?: { display_name: string } | null;
}

export interface Response {
  id: string;
  engagement_id: string;
  user_id: string;
  content: Record<string, unknown>;
  rating: number | null;
  created_at: string;
}

export interface Reaction {
  id: string;
  response_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface Comment {
  id: string;
  engagement_id: string;
  response_id: string | null;
  user_id: string;
  content: string;
  created_at: string;
}

export interface Nudge {
  id: string;
  engagement_id: string;
  from_user_id: string;
  to_user_id: string;
  created_at: string;
}

export interface Streak {
  user_id: string;
  group_id: string;
  current_streak: number;
  longest_streak: number;
  last_participated: string | null;
}

export interface Milestone {
  id: string;
  group_id: string;
  type: string;
  value: number;
  reached_at: string;
}

export interface Favourite {
  user_id: string;
  engagement_id: string;
  created_at: string;
}

// ── Enriched types (with joins) ──
export interface GroupWithMembers extends Group {
  members: (GroupMember & { profile: Profile })[];
  member_count: number;
}

export interface EngagementWithResponses extends Engagement {
  responses: (Response & { profile: Profile })[];
  response_count: number;
  creator: Profile;
}

// ── Engagement type metadata ──
// `description` = factual (used in the create flow).
// `hook` = a short, enticing one-liner shown on cards to pull people in.
export const ENGAGEMENT_TYPES: Record<
  EngagementType,
  { icon: string; label: string; description: string; hook: string; color: string }
> = {
  poll: { icon: "📊", label: "Poll", description: "Multiple choice, yes/no, or open questions", hook: "Cast your vote — nobody sees the tally until everyone's in.", color: "bg-blue-50 text-blue-700" },
  challenge: { icon: "🏆", label: "Challenge", description: "Video, photo, or task-based challenges with deadlines", hook: "Show us what you've got — entries stay hidden until the big reveal.", color: "bg-amber-50 text-amber-700" },
  truth_or_dare: { icon: "🎯", label: "Truth or Dare", description: "Classic game with optional real stakes", hook: "Truth or dare? Lock in your answer before anyone else can peek.", color: "bg-red-50 text-red-700" },
  photo_pose: { icon: "📸", label: "Photo Pose", description: "Request a picture in a specific scenario", hook: "Strike the pose and snap it — every photo drops at the same moment.", color: "bg-pink-50 text-pink-700" },
  share: { icon: "💬", label: "Share", description: "Request a favourite recipe, memory, or anything meaningful", hook: "Share yours — everyone's reveals together, all at once.", color: "bg-green-50 text-green-700" },
  accountability: { icon: "🙏", label: "Accountability", description: "Structured check-in questions for distance groups", hook: "A quick, honest check-in — answers unlock together, no peeking.", color: "bg-violet-50 text-violet-700" },
  game: { icon: "♟️", label: "Game", description: "Turn-based games: chess, word games, spelling bees", hook: "Your move — jump in and play.", color: "bg-indigo-50 text-indigo-700" },
  instant: { icon: "🧠", label: "Instant", description: "Trivia, math, Pictionary — quick-fire fun", hook: "Quick-fire round — think fast and lock it in!", color: "bg-cyan-50 text-cyan-700" },
  anonymous_judge: { icon: "⚖️", label: "Anonymous Judge", description: "Submit entries anonymously, group rates blind", hook: "Submit anonymously and let the group judge blind.", color: "bg-slate-50 text-slate-700" },
  guess: { icon: "🔍", label: "Guess", description: "Post a mystery photo for the group to guess", hook: "Can you crack it? Take your guess before the reveal.", color: "bg-orange-50 text-orange-700" },
  surprise: { icon: "🎉", label: "Surprise", description: "Coordinate greetings hidden from the recipient", hook: "Add your bit to a surprise they'll never see coming. 🤫", color: "bg-yellow-50 text-yellow-700" },
  advice: { icon: "💡", label: "Advice", description: "Ask your group for counsel", hook: "Weigh in — the group wants your honest take.", color: "bg-teal-50 text-teal-700" },
  voice_response: { icon: "🎤", label: "Voice Response", description: "Leave voice notes instead of text", hook: "Say it out loud — drop a quick voice note.", color: "bg-rose-50 text-rose-700" },
};

// ── Supabase Database type (simplified — use supabase gen types for full version) ──
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; display_name: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      groups: {
        Row: Group;
        Insert: Partial<Group> & { name: string; creator_id: string };
        Update: Partial<Group>;
        Relationships: [];
      };
      group_members: {
        Row: GroupMember;
        Insert: GroupMember;
        Update: Partial<GroupMember>;
        Relationships: [];
      };
      engagements: {
        Row: Engagement;
        Insert: Partial<Engagement> & { group_id: string; creator_id: string; type: EngagementType; title: string };
        Update: Partial<Engagement>;
        Relationships: [];
      };
      responses: {
        Row: Response;
        Insert: Partial<Response> & { engagement_id: string; user_id: string; content: Record<string, unknown> };
        Update: Partial<Response>;
        Relationships: [];
      };
      reactions: {
        Row: Reaction;
        Insert: Partial<Reaction> & { response_id: string; user_id: string; emoji: string };
        Update: Partial<Reaction>;
        Relationships: [];
      };
      comments: {
        Row: Comment;
        Insert: Partial<Comment> & { engagement_id: string; user_id: string; content: string };
        Update: Partial<Comment>;
        Relationships: [];
      };
      nudges: {
        Row: Nudge;
        Insert: Partial<Nudge> & { engagement_id: string; from_user_id: string; to_user_id: string };
        Update: Partial<Nudge>;
        Relationships: [];
      };
      streaks: {
        Row: Streak;
        Insert: Streak;
        Update: Partial<Streak>;
        Relationships: [];
      };
      milestones: {
        Row: Milestone;
        Insert: Partial<Milestone> & { group_id: string; type: string; value: number };
        Update: Partial<Milestone>;
        Relationships: [];
      };
      favourites: {
        Row: Favourite;
        Insert: Favourite;
        Update: Partial<Favourite>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      engagement_type: EngagementType;
      engagement_status: EngagementStatus;
      reveal_mode: RevealMode;
    };
    CompositeTypes: Record<string, never>;
  };
}
