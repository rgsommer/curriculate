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

    const { data: group } = await supabase
      .from("groups")
      .select("*")
      .eq("invite_code", inviteCode.toUpperCase())
      .single();

    if (!group) return { error: "Invalid invite code" };

    // Check if already a member
    const { data: existing } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", group.id)
      .eq("user_id", user.id)
      .single();

    if (existing) return { error: "Already a member", groupId: group.id };

    const { error } = await supabase
      .from("group_members")
      .insert({ group_id: group.id, user_id: user.id, role: "member" });

    if (error) return { error: error.message };

    await fetchGroups();
    return { error: null, groupId: group.id };
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
      // Get response counts for each engagement
      const enriched = await Promise.all(
        engRes.data.map(async (e) => {
          const { count } = await supabase
            .from("responses")
            .select("*", { count: "exact", head: true })
            .eq("engagement_id", e.id);
          return { ...e, response_count: count ?? 0 } as Engagement & { response_count: number };
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

  return { group, members, engagements, streaks, invitations, loading, refresh: fetchGroup };
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

    // Get response count (always visible even when sealed)
    const { count } = await supabase
      .from("responses")
      .select("*", { count: "exact", head: true })
      .eq("engagement_id", engagementId);
    setResponseCount(count ?? 0);

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
    loading,
    submitResponse,
    addReaction,
    addRating,
    addComment,
    sendNudge,
    revealNow,
    removeResponse,
    reportResponse,
    refresh: fetchEngagement,
  };
}

// ── Create Engagement ──

export function useCreateEngagement(groupId: string) {
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
  }) => {
    if (!user) return { error: "Not logged in", engagement: null };

    const { data, error } = await supabase
      .from("engagements")
      .insert({
        group_id: groupId,
        creator_id: user.id,
        type: params.type,
        title: params.title,
        description: params.description ?? null,
        config: params.config ?? {},
        deadline: params.deadline?.toISOString() ?? null,
        reveal: params.reveal ?? "sealed",
        is_blind: params.is_blind ?? false,
        recurrence_rule: params.recurrence_rule ?? null,
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

    return () => {
      supabase.removeChannel(responseSub);
      supabase.removeChannel(engSub);
      supabase.removeChannel(nudgeSub);
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

    return () => {
      supabase.removeChannel(engSub);
      supabase.removeChannel(memberSub);
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
