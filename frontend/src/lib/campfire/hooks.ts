"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./AuthProvider";
import type {
  Group,
  GroupMember,
  Profile,
  Engagement,
  Response,
  Reaction,
  Comment,
  Streak,
  Invitation,
  Rating,
  EngagementType,
  RevealMode,
  LieGuess,
  LieAnswer,
  RevealAnswer,
  CareAnswer,
} from "./types";

// ── Groups ──

export function useGroups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<(Group & { member_count: number })[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Get groups the user is a member of
    const { data: memberships } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id);

    if (!memberships?.length) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const groupIds = memberships.map((m) => m.group_id);
    const { data: groupsData } = await supabase
      .from("groups")
      .select("*")
      .in("id", groupIds)
      .order("created_at", { ascending: false });

    // Get member counts
    const enriched = await Promise.all(
      (groupsData ?? []).map(async (g) => {
        const { count } = await supabase
          .from("group_members")
          .select("*", { count: "exact", head: true })
          .eq("group_id", g.id);
        return { ...g, member_count: count ?? 0 } as Group & { member_count: number };
      })
    );

    setGroups(enriched);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const createGroup = async (name: string, description: string, emoji: string) => {
    if (!user) return { group: null, error: "You're not signed in." };

    const { data: group, error } = await supabase
      .from("groups")
      .insert({ name, description, creator_id: user.id, avatar_emoji: emoji })
      .select()
      .single();

    if (error || !group) {
      return {
        group: null,
        error: error?.message ?? "Could not create the group.",
      };
    }

    // Add creator as admin member
    await supabase
      .from("group_members")
      .insert({ group_id: group.id, user_id: user.id, role: "admin" });

    await fetchGroups();
    return { group: group as Group, error: null };
  };

  const joinGroup = async (inviteCode: string) => {
    if (!user) return { error: "Not logged in" };

    // Resolve the code + join in one RLS-safe step. A non-member can't SELECT a
    // group by invite_code (groups SELECT policy is members-only), so we go
    // through a SECURITY DEFINER function that looks up the code and joins the
    // caller. Idempotent — re-joining just returns the same group id.
    const { data: gid, error } = await supabase.rpc("join_group_by_code", {
      _code: inviteCode,
    });

    if (error) return { error: error.message };
    if (!gid) return { error: "Invalid invite code" };

    await fetchGroups();
    return { error: null, groupId: gid as string };
  };

  // Join a SINGLE engagement as a guest — access to just that card, NOT the group.
  // Used when an invite link is scoped to an engagement (carries ?e=<id>).
  const joinEngagementAsGuest = async (engagementId: string, invitedEmail?: string | null) => {
    if (!user) return { error: "Not logged in" };
    const { data: gid, error } = await supabase.rpc("join_engagement_as_guest", {
      _eid: engagementId,
      _email: invitedEmail ?? null,
    });
    if (error) return { error: error.message };
    if (!gid) return { error: "This card isn't available." };
    return { error: null, groupId: gid as string };
  };

  // Host flips a group's digest settings straight from the dashboard card.
  const setGroupNotify = async (
    groupId: string,
    field: "notify_on_response" | "notify_host",
    on: boolean
  ) => {
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, [field]: on } : g))
    ); // optimistic
    const { error } = await supabase
      .from("groups")
      .update({ [field]: on })
      .eq("id", groupId);
    if (error) await fetchGroups();
    return { error: error?.message ?? null };
  };

  return {
    groups,
    loading,
    createGroup,
    joinGroup,
    joinEngagementAsGuest,
    setGroupNotify,
    refresh: fetchGroups,
  };
}

// ── Single Group Detail ──

export function useGroup(groupId: string) {
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<(GroupMember & { profile: Profile })[]>([]);
  const [engagements, setEngagements] = useState<(Engagement & { response_count: number })[]>([]);
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGroup = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user || !groupId) return;
    // Realtime-triggered refreshes run "silent" so the page doesn't flash its
    // full-screen loading state on every incoming change.
    if (!opts?.silent) setLoading(true);

    const [groupRes, membersRes, engRes, streakRes, invRes] = await Promise.all([
      supabase.from("groups").select("*").eq("id", groupId).single(),
      supabase
        .from("group_members")
        .select("*, profile:profiles(*)")
        .eq("group_id", groupId),
      supabase
        .from("engagements")
        .select("*, creator:profiles!creator_id(display_name)")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false }),
      supabase
        .from("streaks")
        .select("*")
        .eq("group_id", groupId),
      supabase
        .from("campfire_invitations")
        .select("*")
        .eq("group_id", groupId)
        // Only whole-group invites belong here — engagement-scoped guest invites
        // (engagement_id set) are tracked on their own card, not in the group.
        .is("engagement_id", null)
        .order("created_at", { ascending: true }),
    ]);

    if (groupRes.data) setGroup(groupRes.data as Group);

    if (membersRes.data) {
      setMembers(membersRes.data as (GroupMember & { profile: Profile })[]);
    }

    if (engRes.data) {
      // Get the TRUE response count per engagement. A plain count is limited by
      // the "sealed" RLS policy to the viewer's own response, so it under-reports
      // before the reveal. One batched SECURITY DEFINER call returns every count at
      // once (was N+1: one RPC per engagement).
      const ids = engRes.data.map((e) => e.id);
      const counts = new Map<string, number>();
      if (ids.length) {
        const { data: rows } = await supabase.rpc("engagement_response_counts", {
          _eids: ids,
        });
        for (const row of (rows as { engagement_id: string; n: number }[]) ?? []) {
          counts.set(row.engagement_id, row.n);
        }
      }
      setEngagements(
        engRes.data.map(
          (e) =>
            ({ ...e, response_count: counts.get(e.id) ?? 0 } as Engagement & {
              response_count: number;
            })
        )
      );
    }

    if (streakRes.data) setStreaks(streakRes.data as Streak[]);
    if (invRes.data) setInvitations(invRes.data as Invitation[]);
    setLoading(false);
  }, [user, groupId]);

  useEffect(() => {
    fetchGroup();
  }, [fetchGroup]);

  // Set the current user's name *in this group* (e.g. "Dad" / "Mr. Sommer").
  const setMyGroupName = async (name: string) => {
    const { error } = await supabase.rpc("set_group_display_name", {
      _group_id: groupId,
      _name: name,
    });
    if (!error) await fetchGroup();
    return { error: error?.message ?? null };
  };

  // Creator deletes the whole group (cascades engagements, members, invites…).
  const deleteGroup = async () => {
    const { error } = await supabase.from("groups").delete().eq("id", groupId);
    return { error: error?.message ?? null };
  };

  // Admin sets another member's per-group display name.
  const setMemberName = async (userId: string, name: string) => {
    const { error } = await supabase.rpc("set_member_display_name", {
      _group_id: groupId,
      _user_id: userId,
      _name: name,
    });
    if (!error) await fetchGroup();
    return { error: error?.message ?? null };
  };

  // Admin promotes/demotes a member (creator stays admin; enforced server-side).
  const setMemberRole = async (userId: string, role: "admin" | "member") => {
    const { error } = await supabase.rpc("set_member_role", {
      _group_id: groupId,
      _user_id: userId,
      _role: role,
    });
    if (!error) await fetchGroup();
    return { error: error?.message ?? null };
  };

  // A member leaves the group (removes their own membership).
  const leaveGroup = async () => {
    if (!user) return { error: "Not signed in" };
    const { error } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", user.id);
    return { error: error?.message ?? null };
  };

  // Host toggles whether members (not just the host) may invite others.
  const setAllowMemberInvites = async (allow: boolean) => {
    setGroup((g) => (g ? { ...g, allow_member_invites: allow } : g)); // optimistic
    const { error } = await supabase
      .from("groups")
      .update({ allow_member_invites: allow })
      .eq("id", groupId);
    if (error) await fetchGroup();
    return { error: error?.message ?? null };
  };

  // Host toggles the member daily "new responses" digest for this group.
  const setNotifyOnResponse = async (on: boolean) => {
    setGroup((g) => (g ? { ...g, notify_on_response: on } : g)); // optimistic
    const { error } = await supabase
      .from("groups")
      .update({ notify_on_response: on })
      .eq("id", groupId);
    if (error) await fetchGroup();
    return { error: error?.message ?? null };
  };

  // Host toggles their OWN all-activity digest (independent of the member one).
  const setNotifyHost = async (on: boolean) => {
    setGroup((g) => (g ? { ...g, notify_host: on } : g)); // optimistic
    const { error } = await supabase
      .from("groups")
      .update({ notify_host: on })
      .eq("id", groupId);
    if (error) await fetchGroup();
    return { error: error?.message ?? null };
  };

  // Admin renames the group (RLS allows only the creator/admin to update).
  const renameGroup = async (name: string, description?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return { error: "Name can't be empty" };
    const desc = description !== undefined ? description.trim() || null : undefined;
    const fields: { name: string; description?: string | null } = { name: trimmed };
    if (desc !== undefined) fields.description = desc;
    setGroup((g) =>
      g ? { ...g, name: trimmed, ...(desc !== undefined ? { description: desc } : {}) } : g
    ); // optimistic
    const { error } = await supabase.from("groups").update(fields).eq("id", groupId);
    if (error) await fetchGroup(); // revert on failure
    return { error: error?.message ?? null };
  };

  return {
    group,
    members,
    engagements,
    streaks,
    invitations,
    loading,
    refresh: fetchGroup,
    renameGroup,
    setMyGroupName,
    setAllowMemberInvites,
    setNotifyOnResponse,
    setNotifyHost,
    leaveGroup,
    deleteGroup,
    setMemberRole,
    setMemberName,
  };
}

// ── Engagement Detail (with sealed reveal) ──

export function useEngagement(engagementId: string) {
  const { user } = useAuth();
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [responses, setResponses] = useState<(Response & { profile: Profile })[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [comments, setComments] = useState<(Comment & { profile: Profile })[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [myResponse, setMyResponse] = useState<Response | null>(null);
  const [responseCount, setResponseCount] = useState(0);
  const [lieGuesses, setLieGuesses] = useState<LieGuess[]>([]);
  const [lieAnswers, setLieAnswers] = useState<LieAnswer[]>([]);
  const [revealAnswer, setRevealAnswerState] = useState<RevealAnswer | null>(null);
  const [views, setViews] = useState<{ user_id: string; seen_at: string }[]>([]);
  const [careAnswers, setCareAnswers] = useState<CareAnswer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEngagement = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user || !engagementId) return;
    // Realtime-triggered refreshes run "silent" — no loading flip, no page blank.
    if (!opts?.silent) setLoading(true);

    const { data: eng } = await supabase
      .from("engagements")
      .select("*, creator:profiles!creator_id(display_name)")
      .eq("id", engagementId)
      .single();

    if (eng) setEngagement(eng as Engagement);

    // True response count (the sealed RLS policy would otherwise limit a plain
    // count to the viewer's own response, under-reporting before the reveal).
    const { data: rc } = await supabase.rpc("engagement_response_count", {
      _eid: engagementId,
    });
    setResponseCount((rc as number) ?? 0);

    // Get my response (RLS allows seeing own)
    const { data: mine } = await supabase
      .from("responses")
      .select("*")
      .eq("engagement_id", engagementId)
      .eq("user_id", user.id)
      .single();
    if (mine) setMyResponse(mine as Response);

    // Responses are only visible if engagement is revealed (RLS enforced)
    const { data: resps } = await supabase
      .from("responses")
      .select("*, profile:profiles(*)")
      .eq("engagement_id", engagementId);
    if (resps) setResponses(resps as (Response & { profile: Profile })[]);

    // Care Check-in: per-question answers (RLS returns only what the viewer may see —
    // own always, shared to the group, and host-only to the host).
    if (eng?.type === "care") {
      const { data: ca } = await supabase
        .from("campfire_care_answers")
        .select("*, profile:profiles(display_name)")
        .eq("engagement_id", engagementId);
      setCareAnswers((ca as CareAnswer[]) ?? []);
    } else {
      setCareAnswers([]);
    }

    // Two Truths & a Lie: guesses (RLS: members) + answers (RLS: own + after reveal)
    if (eng?.type === "two_truths") {
      const [guessRes, ansRes] = await Promise.all([
        supabase.from("campfire_lie_guesses").select("*").eq("engagement_id", engagementId),
        supabase.from("campfire_lie_answers").select("*").eq("engagement_id", engagementId),
      ]);
      setLieGuesses((guessRes.data as LieGuess[]) ?? []);
      setLieAnswers((ansRes.data as LieAnswer[]) ?? []);
    } else {
      setLieGuesses([]);
      setLieAnswers([]);
    }

    // Baby Reveal: the host's secret answer (RLS: host always; others post-reveal)
    if (eng?.type === "baby_reveal") {
      const { data: ra } = await supabase
        .from("campfire_reveal_answers")
        .select("*")
        .eq("engagement_id", engagementId)
        .maybeSingle();
      setRevealAnswerState((ra as RevealAnswer) ?? null);
    } else {
      setRevealAnswerState(null);
    }

    // Read receipts: record this view + load who's seen it (revealed only).
    if (eng?.status === "revealed") {
      await supabase
        .from("campfire_engagement_views")
        .upsert(
          { engagement_id: engagementId, user_id: user.id },
          { onConflict: "engagement_id,user_id", ignoreDuplicates: true }
        );
      const { data: vw } = await supabase
        .from("campfire_engagement_views")
        .select("user_id, seen_at")
        .eq("engagement_id", engagementId);
      setViews((vw as { user_id: string; seen_at: string }[]) ?? []);
    } else {
      setViews([]);
    }

    // Reactions, comments & ratings (also RLS-gated to revealed engagements)
    if (eng?.status === "revealed") {
      const [reactRes, commentRes, ratingRes] = await Promise.all([
        supabase.from("reactions").select("*").in(
          "response_id",
          (resps ?? []).map((r) => r.id)
        ),
        supabase
          .from("comments")
          .select("*, profile:profiles(*)")
          .eq("engagement_id", engagementId)
          .order("created_at", { ascending: true }),
        supabase
          .from("campfire_ratings")
          .select("*")
          .eq("engagement_id", engagementId),
      ]);
      if (reactRes.data) setReactions(reactRes.data as Reaction[]);
      if (commentRes.data) setComments(commentRes.data as (Comment & { profile: Profile })[]);
      if (ratingRes.data) setRatings(ratingRes.data as Rating[]);
    }

    setLoading(false);
  }, [user, engagementId]);

  useEffect(() => {
    fetchEngagement();
  }, [fetchEngagement]);

  // Submit (or edit) a response. Upsert so re-submitting before the reveal updates
  // the existing answer instead of failing the unique (engagement_id, user_id).
  // On first submit this inserts (firing the all-responded check); an edit is an
  // ON CONFLICT update, which doesn't re-fire that trigger — so counts stay right.
  const submitResponse = async (
    content: Record<string, unknown>,
    // Optional row-level fields (e.g. a per-response visibility choice). Omitted
    // keys are left untouched on edit, so we don't clobber a prior choice.
    extra?: Record<string, unknown>
  ) => {
    if (!user || !engagementId) return { error: "Missing data" };

    const { error } = await supabase.from("responses").upsert(
      {
        engagement_id: engagementId,
        user_id: user.id,
        content,
        ...(extra ?? {}),
      },
      { onConflict: "engagement_id,user_id" }
    );

    if (error) return { error: error.message };
    await fetchEngagement();
    return { error: null };
  };

  // Care Check-in: upsert the umbrella response (the "checked in" marker, host-only —
  // it carries no answer content), then replace this person's per-question answer rows.
  // Each answer carries its own visibility (share_to_group / anonymous).
  const submitCareAnswers = async (
    rows: {
      q_index: number;
      value: string;
      share_to_group: boolean;
      anonymous: boolean;
    }[]
  ) => {
    if (!user || !engagementId) return { error: "Missing data" };

    const { data: resp, error: rErr } = await supabase
      .from("responses")
      .upsert(
        {
          engagement_id: engagementId,
          user_id: user.id,
          content: { care: true },
          share_to_group: false,
        },
        { onConflict: "engagement_id,user_id" }
      )
      .select("id")
      .single();
    if (rErr || !resp) return { error: rErr?.message ?? "Could not save" };

    // Replace prior answers (handles edits and cleared questions).
    await supabase.from("campfire_care_answers").delete().eq("response_id", resp.id);
    if (rows.length) {
      const { error: iErr } = await supabase.from("campfire_care_answers").insert(
        rows.map((r) => ({
          engagement_id: engagementId,
          response_id: resp.id,
          user_id: user.id,
          q_index: r.q_index,
          value: r.value,
          share_to_group: r.share_to_group,
          anonymous: r.anonymous,
        }))
      );
      if (iErr) return { error: iErr.message };
    }

    await fetchEngagement();
    return { error: null };
  };

  // Two Truths & a Lie: submit 3 statements + the (hidden) lie index.
  const submitTwoTruths = async (statements: string[], lieIndex: number) => {
    if (!user || !engagementId) return { error: "Missing data" };
    const { data: resp, error } = await supabase
      .from("responses")
      .insert({ engagement_id: engagementId, user_id: user.id, content: { statements } })
      .select("id")
      .single();
    if (error || !resp) return { error: error?.message ?? "Couldn't submit" };
    const { error: aErr } = await supabase.from("campfire_lie_answers").insert({
      engagement_id: engagementId,
      response_id: resp.id,
      lie_index: lieIndex,
    });
    if (aErr) return { error: aErr.message };
    await fetchEngagement();
    return { error: null };
  };

  // Two Truths & a Lie: guess which statement is the lie on someone's entry.
  const submitLieGuess = async (responseId: string, guessIndex: number) => {
    if (!user || !engagementId) return { error: "Missing data" };
    const { error } = await supabase.from("campfire_lie_guesses").upsert(
      {
        engagement_id: engagementId,
        response_id: responseId,
        guesser_id: user.id,
        guess_index: guessIndex,
      },
      { onConflict: "response_id,guesser_id" }
    );
    if (error) return { error: error.message };
    await fetchEngagement();
    return { error: null };
  };

  // Two Truths (anonymous): guess WHO wrote a given entry.
  const submitAuthorGuess = async (responseId: string, authorUserId: string) => {
    if (!user || !engagementId) return { error: "Missing data" };
    const { error } = await supabase.from("campfire_lie_guesses").upsert(
      {
        engagement_id: engagementId,
        response_id: responseId,
        guesser_id: user.id,
        author_guess: authorUserId,
      },
      { onConflict: "response_id,guesser_id" }
    );
    if (error) return { error: error.message };
    await fetchEngagement();
    return { error: null };
  };

  // Baby Reveal: host sets/changes the secret answer (hidden until reveal).
  const setRevealAnswer = async (answer: string) => {
    if (!engagementId) return { error: "Missing engagement" };
    const { error } = await supabase
      .from("campfire_reveal_answers")
      .upsert(
        { engagement_id: engagementId, answer },
        { onConflict: "engagement_id" }
      );
    if (!error) await fetchEngagement();
    return { error: error?.message ?? null };
  };

  // Creator force-reveals the lies (e.g. some players never guessed).
  const revealLiesNow = async () => {
    if (!engagementId) return { error: "Missing engagement" };
    const { error } = await supabase
      .from("engagements")
      .update({ lies_revealed_at: new Date().toISOString() })
      .eq("id", engagementId);
    if (!error) await fetchEngagement();
    return { error: error?.message ?? null };
  };

  // Add reaction
  const addReaction = async (responseId: string, emoji: string) => {
    if (!user) return;
    await supabase.from("reactions").upsert({
      response_id: responseId,
      user_id: user.id,
      emoji,
    });
    await fetchEngagement();
  };

  // Rate a response (1–5). One score per rater per response; re-rating updates.
  const addRating = async (responseId: string, score: number) => {
    if (!user || !engagementId) return;
    await supabase.from("campfire_ratings").upsert(
      {
        response_id: responseId,
        engagement_id: engagementId,
        rater_id: user.id,
        score,
      },
      { onConflict: "response_id,rater_id" }
    );
    await fetchEngagement();
  };

  // Creator triggers the reveal (all_at_once mode, or forcing it early).
  const revealNow = async () => {
    if (!engagementId) return;
    await supabase
      .from("engagements")
      .update({ status: "revealed" })
      .eq("id", engagementId);
    await fetchEngagement();
  };

  // Creator un-reveals — puts it back to sealed/active (e.g. revealed too early).
  const unrevealEngagement = async () => {
    if (!engagementId) return { error: "Missing engagement" };
    const { error } = await supabase
      .from("engagements")
      .update({ status: "active" })
      .eq("id", engagementId);
    if (!error) await fetchEngagement();
    return { error: error?.message ?? null };
  };

  // Creator pauses/resumes: while paused, no emails go out and the cron skips it,
  // so the host can safely add the surprise recipient + mark them "hide from".
  const setPaused = async (paused: boolean) => {
    if (!engagementId) return { error: "Missing engagement" };
    const { error } = await supabase
      .from("engagements")
      .update({ paused })
      .eq("id", engagementId);
    if (!error) await fetchEngagement();
    return { error: error?.message ?? null };
  };

  // Creator toggles "hold until the deadline" on an existing engagement.
  const setHoldUntilDeadline = async (hold: boolean) => {
    if (!engagementId) return { error: "Missing engagement" };
    const { error } = await supabase
      .from("engagements")
      .update({ hold_until_deadline: hold })
      .eq("id", engagementId);
    if (!error) await fetchEngagement();
    return { error: error?.message ?? null };
  };

  // Creator toggles "wait until everyone invited has joined + responded".
  const setWaitForAllInvited = async (wait: boolean) => {
    if (!engagementId) return { error: "Missing engagement" };
    const { error } = await supabase
      .from("engagements")
      .update({ wait_for_all_invited: wait })
      .eq("id", engagementId);
    if (!error) await fetchEngagement();
    return { error: error?.message ?? null };
  };

  // Creator launches a draft engagement — makes it live (visible to the group).
  const launchEngagement = async () => {
    if (!engagementId) return { error: "Missing engagement" };
    // Launching = open it NOW. Clear any future open-schedule so the card is
    // genuinely open to sign (and so the "new engagement" email is appropriate);
    // a card left unlaunched stays scheduled and auto-opens + emails on its date.
    const { error } = await supabase
      .from("engagements")
      .update({ launched_at: new Date().toISOString(), scheduled_open_at: null })
      .eq("id", engagementId);
    if (!error) await fetchEngagement();
    return { error: error?.message ?? null };
  };

  // Creator cancels (deletes) the engagement.
  const deleteEngagement = async () => {
    if (!engagementId) return { error: "Missing engagement" };
    const { error } = await supabase.from("engagements").delete().eq("id", engagementId);
    return { error: error?.message ?? null };
  };

  // Moderation: remove a response (creator/admin; RLS-enforced).
  const removeResponse = async (responseId: string) => {
    await supabase.from("responses").delete().eq("id", responseId);
    await fetchEngagement();
  };

  // Moderation: report a response.
  const reportResponse = async (responseId: string, reason?: string) => {
    if (!user || !engagementId) return;
    await supabase.from("campfire_reports").upsert(
      {
        response_id: responseId,
        engagement_id: engagementId,
        reporter_id: user.id,
        reason: reason ?? null,
      },
      { onConflict: "response_id,reporter_id" }
    );
  };

  // Add comment
  const addComment = async (text: string, responseId?: string, anonymous?: boolean) => {
    if (!user || !engagementId) return;
    await supabase.from("comments").insert({
      engagement_id: engagementId,
      response_id: responseId ?? null,
      user_id: user.id,
      content: text,
      anonymous: !!anonymous,
    });
    await fetchEngagement();
  };

  // Send nudge
  const sendNudge = async (toUserId: string) => {
    if (!user || !engagementId) return;
    await supabase.from("nudges").insert({
      engagement_id: engagementId,
      from_user_id: user.id,
      to_user_id: toUserId,
    });
  };

  return {
    engagement,
    responses,
    reactions,
    comments,
    ratings,
    myResponse,
    responseCount,
    lieGuesses,
    lieAnswers,
    revealAnswer,
    views,
    careAnswers,
    loading,
    submitResponse,
    submitCareAnswers,
    submitTwoTruths,
    submitLieGuess,
    submitAuthorGuess,
    revealLiesNow,
    setRevealAnswer,
    addReaction,
    addRating,
    addComment,
    sendNudge,
    revealNow,
    unrevealEngagement,
    setPaused,
    setHoldUntilDeadline,
    setWaitForAllInvited,
    launchEngagement,
    deleteEngagement,
    removeResponse,
    reportResponse,
    refresh: fetchEngagement,
  };
}

// ── Create Engagement ──

export function useCreateEngagement(defaultGroupId?: string) {
  const { user } = useAuth();

  const create = async (params: {
    type: EngagementType;
    title: string;
    description?: string;
    config?: Record<string, unknown>;
    deadline?: Date;
    reveal?: RevealMode;
    is_blind?: boolean;
    recurrence_rule?: string;
    notify?: boolean;
    hold_until_deadline?: boolean;
    wait_for_all_invited?: boolean;
    allow_member_invites?: boolean;
    excluded_user_ids?: string[];
    excluded_emails?: string[];
    cover_image_url?: string;
    cover_image_urls?: string[];
    scheduled_open_at?: string | null;
    lead_days?: number;
    birth_year?: number | null;
    launched_at?: string | null;
    private_to_host?: boolean;
    allow_anon_replies?: boolean;
    groupId?: string; // target group (defaults to the bound one)
  }) => {
    if (!user) return { error: "Not logged in", engagement: null };
    const targetGroupId = params.groupId ?? defaultGroupId;
    if (!targetGroupId) return { error: "No group selected", engagement: null };

    const { data, error } = await supabase
      .from("engagements")
      .insert({
        group_id: targetGroupId,
        creator_id: user.id,
        type: params.type,
        title: params.title,
        description: params.description ?? null,
        config: params.config ?? {},
        deadline: params.deadline?.toISOString() ?? null,
        reveal: params.reveal ?? "sealed",
        is_blind: params.is_blind ?? false,
        recurrence_rule: params.recurrence_rule ?? null,
        notify: params.notify ?? false,
        hold_until_deadline: params.hold_until_deadline ?? false,
        wait_for_all_invited: params.wait_for_all_invited ?? false,
        allow_member_invites: params.allow_member_invites ?? false,
        excluded_user_ids: params.excluded_user_ids ?? [],
        excluded_emails: params.excluded_emails ?? [],
        cover_image_url: params.cover_image_url ?? null,
        cover_image_urls: params.cover_image_urls ?? [],
        scheduled_open_at: params.scheduled_open_at ?? null,
        lead_days: params.lead_days ?? 14,
        birth_year: params.birth_year ?? null,
        private_to_host: params.private_to_host ?? false,
        allow_anon_replies: params.allow_anon_replies ?? false,
        ...(params.launched_at !== undefined ? { launched_at: params.launched_at } : {}),
      })
      .select()
      .single();

    return {
      error: error?.message ?? null,
      engagement: data as Engagement | null,
    };
  };

  return { create };
}

// ── Real-time Subscriptions ──

export function useRealtimeEngagement(engagementId: string, onUpdate: () => void) {
  // Keep the latest callback in a ref so a new onUpdate identity doesn't tear down
  // and re-create all the channels every render.
  const cbRef = useRef(onUpdate);
  cbRef.current = onUpdate;

  useEffect(() => {
    if (!engagementId) return;

    // Coalesce bursts: many rows can change at once (e.g. everyone submitting), and
    // each one used to trigger a full page reload. Debounce so a burst becomes ONE
    // refresh instead of N.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        cbRef.current();
      }, 250);
    };

    // Subscribe to new responses on this engagement
    const responseSub = supabase
      .channel(`responses:${engagementId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "responses",
          filter: `engagement_id=eq.${engagementId}`,
        },
        fire
      )
      .subscribe();

    // Subscribe to engagement status changes (sealed → revealed)
    const engSub = supabase
      .channel(`engagement:${engagementId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "engagements",
          filter: `id=eq.${engagementId}`,
        },
        fire
      )
      .subscribe();

    // Subscribe to nudges
    const nudgeSub = supabase
      .channel(`nudges:${engagementId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "nudges",
          filter: `engagement_id=eq.${engagementId}`,
        },
        fire
      )
      .subscribe();

    // Two Truths & a Lie: subscribe to guesses so the "X of Y guessed" progress
    // ticks up live for everyone (the reveal flip itself rides on the engagement
    // UPDATE subscription above).
    const guessSub = supabase
      .channel(`lie-guesses:${engagementId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campfire_lie_guesses",
          filter: `engagement_id=eq.${engagementId}`,
        },
        fire
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(responseSub);
      supabase.removeChannel(engSub);
      supabase.removeChannel(nudgeSub);
      supabase.removeChannel(guessSub);
    };
  }, [engagementId]);
}

export function useRealtimeGroup(groupId: string, onUpdate: () => void) {
  const cbRef = useRef(onUpdate);
  cbRef.current = onUpdate;

  useEffect(() => {
    if (!groupId) return;

    // Coalesce bursts (e.g. a batch of invites or joins) into one refresh.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        cbRef.current();
      }, 250);
    };

    // Subscribe to new engagements in this group
    const engSub = supabase
      .channel(`group-engagements:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "engagements",
          filter: `group_id=eq.${groupId}`,
        },
        fire
      )
      .subscribe();

    // Subscribe to member changes
    const memberSub = supabase
      .channel(`group-members:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_members",
          filter: `group_id=eq.${groupId}`,
        },
        fire
      )
      .subscribe();

    // Subscribe to invitation changes (so the host's invite list flips to
    // "joined" / reflects new adds without a manual refresh).
    const inviteSub = supabase
      .channel(`group-invitations:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campfire_invitations",
          filter: `group_id=eq.${groupId}`,
        },
        fire
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(engSub);
      supabase.removeChannel(memberSub);
      supabase.removeChannel(inviteSub);
    };
  }, [groupId]);
}

// ── Presence (who's online in a group) ──

export function usePresence(groupId: string) {
  const { user, profile } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  useEffect(() => {
    if (!groupId || !user || !profile) return;

    const channel = supabase.channel(`presence:${groupId}`, {
      config: { presence: { key: user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineUsers(Object.keys(state));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: user.id,
            display_name: profile.display_name,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, user, profile]);

  return { onlineUsers };
}
