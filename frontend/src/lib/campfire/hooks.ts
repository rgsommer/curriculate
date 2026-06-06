"use client";

import { useEffect, useState, useCallback } from "react";
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

  return { groups, loading, createGroup, joinGroup, refresh: fetchGroups };
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

  const fetchGroup = useCallback(async () => {
    if (!user || !groupId) return;
    setLoading(true);

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
        .order("created_at", { ascending: true }),
    ]);

    if (groupRes.data) setGroup(groupRes.data as Group);

    if (membersRes.data) {
      setMembers(membersRes.data as (GroupMember & { profile: Profile })[]);
    }

    if (engRes.data) {
      // Get the TRUE response count per engagement. A plain count is limited by
      // the "sealed" RLS policy to the viewer's own response, so it under-reports
      // before the reveal — this SECURITY DEFINER function returns the real number.
      const enriched = await Promise.all(
        engRes.data.map(async (e) => {
          const { data: rc } = await supabase.rpc("engagement_response_count", {
            _eid: e.id,
          });
          return { ...e, response_count: (rc as number) ?? 0 } as Engagement & { response_count: number };
        })
      );
      setEngagements(enriched);
    }

    if (streakRes.data) setStreaks(streakRes.data as Streak[]);
    if (invRes.data) setInvitations(invRes.data as Invitation[]);
    setLoading(false);
  }, [user, groupId]);

  useEffect(() => {
    fetchGroup();
  }, [fetchGroup]);

  // Admin renames the group (RLS allows only the creator/admin to update).
  const renameGroup = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return { error: "Name can't be empty" };
    setGroup((g) => (g ? { ...g, name: trimmed } : g)); // optimistic
    const { error } = await supabase
      .from("groups")
      .update({ name: trimmed })
      .eq("id", groupId);
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
  const [loading, setLoading] = useState(true);

  const fetchEngagement = useCallback(async () => {
    if (!user || !engagementId) return;
    setLoading(true);

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

  // Submit a response
  const submitResponse = async (content: Record<string, unknown>) => {
    if (!user || !engagementId) return { error: "Missing data" };

    const { error } = await supabase.from("responses").insert({
      engagement_id: engagementId,
      user_id: user.id,
      content,
    });

    if (error) return { error: error.message };
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
    const { error } = await supabase
      .from("engagements")
      .update({ launched_at: new Date().toISOString() })
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
  const addComment = async (text: string, responseId?: string) => {
    if (!user || !engagementId) return;
    await supabase.from("comments").insert({
      engagement_id: engagementId,
      response_id: responseId ?? null,
      user_id: user.id,
      content: text,
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
    loading,
    submitResponse,
    submitTwoTruths,
    submitLieGuess,
    revealLiesNow,
    addReaction,
    addRating,
    addComment,
    sendNudge,
    revealNow,
    unrevealEngagement,
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
  useEffect(() => {
    if (!engagementId) return;

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
        () => onUpdate()
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
        () => onUpdate()
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
        () => onUpdate()
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
        () => onUpdate()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(responseSub);
      supabase.removeChannel(engSub);
      supabase.removeChannel(nudgeSub);
      supabase.removeChannel(guessSub);
    };
  }, [engagementId, onUpdate]);
}

export function useRealtimeGroup(groupId: string, onUpdate: () => void) {
  useEffect(() => {
    if (!groupId) return;

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
        () => onUpdate()
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
        () => onUpdate()
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
        () => onUpdate()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(engSub);
      supabase.removeChannel(memberSub);
      supabase.removeChannel(inviteSub);
    };
  }, [groupId, onUpdate]);
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
