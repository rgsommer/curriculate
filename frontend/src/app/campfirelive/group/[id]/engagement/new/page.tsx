"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCreateEngagement, useGroups } from "@/lib/campfire/hooks";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { supabase } from "@/lib/campfire/supabase";
import {
  ENGAGEMENT_TYPES,
  resolveTitle,
  nextNthWeekday,
  nextMonthlyNthWeekday,
  describeNthWeekday,
  HOLIDAY_PRESETS,
  ORDINAL_WEEK,
  WEEKDAY_NAMES,
  MONTH_NAMES,
  GIFT_CURRENCIES,
  formatMoney,
  localeGiftCurrency,
  selectPoolQuestions,
  HALL_OF_FAME_SUGGESTIONS,
  type NthWeekday,
  type EngagementType,
  type RevealMode,
} from "@/lib/campfire/types";
import { TEMPLATE_PACKS, type EngagementTemplate } from "@/lib/campfire/templates";

// Plain-language "how it works" per type — { how it works, what each person sees }.
const TYPE_HELP: Partial<Record<EngagementType, { how: string; sees: string }>> = {
  poll: {
    how: "Everyone votes on the options you set. Sealed until all respond, then the tally reveals together.",
    sees: "Your question + tappable options. They pick one and lock it in.",
  },
  share: {
    how: "Everyone answers your prompt. Nobody sees others' until everyone's in, then it all reveals at once.",
    sees: "Your prompt + a text box to write their response.",
  },
  two_truths: {
    how: "Each person writes 3 statements (2 true, 1 lie) and marks the lie. Once everyone's in, the group guesses each other's lie — answers unlock when all have guessed.",
    sees: "3 boxes + a 🤥 to mark their lie. At the reveal, others' statements with a 'pick the lie' choice.",
  },
  baby_reveal: {
    how: "You set the choices (Boy/Girl, name, date…). Everyone guesses. It stays sealed until the reveal date, then winners are crowned. Set the real answer before the date.",
    sees: "Your question + choices to guess between.",
  },
  most_likely: {
    how: "List your awards. Everyone votes a group-mate for each. Sealed until reveal, then each award's winner is shown.",
    sees: "Each award + a name box (autocompletes group members).",
  },
  hall_of_fame: {
    how: "Tap award bubbles (Best Dressed, Funniest…) to build your survey. Everyone votes a group-mate for each; sealed until reveal, then a graph crowns a winner per award. You can gift-card one award's winner.",
    sees: "Each award with a group-mate picker.",
  },
  accountability: {
    how: "List check-in questions. Each person rates themselves 1–5 and can add a note to share. Sealed; turn on Blind to keep answers anonymous.",
    sees: "Each question with a 1–5 scale + an optional 'share with the group' box.",
  },
  scavenger_hunt: {
    how: "List the items/clues. Players answer each with a photo or a typed answer, in any order. You reveal at the end of class.",
    sees: "A numbered list; each item takes a photo upload or text.",
  },
  anonymous_judge: {
    how: "Everyone submits an entry; the group rates them blind — no names attached. The best entry wins.",
    sees: "Your prompt + a box to submit their entry. At the reveal, anonymous entries to rate.",
  },
  surprise: {
    how: "Everyone adds a greeting/message. Use 'Hide from…' in the next step to keep it secret from the recipient — at the reveal it opens for everyone, including them. (Great for a birthday card.)",
    sees: "Your prompt + a box for their greeting. The recipient sees nothing until the reveal.",
  },
  photo_pose: {
    how: "Everyone snaps a photo for your prompt (plus an optional caption). All the photos drop together at the reveal.",
    sees: "Your prompt + an upload button and caption box.",
  },
  challenge: {
    how: "Everyone submits a photo or video for your challenge. Sealed until the reveal, then the group can rate the best.",
    sees: "Your prompt + a photo/video upload.",
  },
  guess: {
    how: "Post a mystery (photo or clue). Everyone submits a guess before the reveal.",
    sees: "Your mystery + a box to guess.",
  },
  truth_or_dare: {
    how: "Everyone answers your truth-or-dare prompt. Sealed until everyone's in, then all reveal together.",
    sees: "Your prompt + a text box.",
  },
};

export default function NewEngagementPage() {
  const params = useParams();
  const groupId = params.id as string;
  const router = useRouter();
  const { create } = useCreateEngagement();
  const { groups, createGroup } = useGroups();
  const { user } = useAuth();

  const [step, setStep] = useState<"type" | "details" | "options">("type");
  const [selectedType, setSelectedType] = useState<EngagementType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reveal, setReveal] = useState<RevealMode>("sealed");
  const [isBlind, setIsBlind] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [holdUntilDeadline, setHoldUntilDeadline] = useState(false);
  const [waitForAllInvited, setWaitForAllInvited] = useState(false);
  const [allowMemberInvites, setAllowMemberInvites] = useState(false);
  // Surprise / "All Except": members hidden from it until the reveal.
  const [groupMembers, setGroupMembers] = useState<{ user_id: string; name: string }[]>([]);
  // Baby Reveal: who reveals the name + gender ("" = me, the host).
  const [babyRevealerId, setBabyRevealerId] = useState("");
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [pendingInvitees, setPendingInvitees] = useState<{ email: string; name: string | null }[]>([]);
  const [excludedEmails, setExcludedEmails] = useState<string[]>([]);
  // Cover images (a pool — Campfire shows a random one)
  const [coverUrls, setCoverUrls] = useState<string[]>([]);
  const [coverPaste, setCoverPaste] = useState("");
  const [coverUploading, setCoverUploading] = useState(false);
  const [pendingForTarget, setPendingForTarget] = useState(0);
  const waitTouched = useRef(false); // don't override a manual toggle
  const [recurrence, setRecurrence] = useState<
    "none" | "daily" | "weekly" | "monthly" | "monthly_nth" | "yearly" | "yearly_nth"
  >("none");
  const [birthYear, setBirthYear] = useState("");
  const [leadDays, setLeadDays] = useState(14);
  // "Release in advance": open + email the group N days before the reveal date.
  const [releaseEarly, setReleaseEarly] = useState(false);
  // Monthly Nth-weekday release (e.g. 2nd Sunday at 4pm): time + how long it stays open.
  const [recurTime, setRecurTime] = useState("16:00");
  const [recurWindowDays, setRecurWindowDays] = useState(3);
  // Keep each person's response visible only to them + the host (default off).
  const [privateToHost, setPrivateToHost] = useState(false);
  // Group gift: chip in toward a gift card that's emailed to the recipient on reveal.
  const [giftEnabled, setGiftEnabled] = useState(false);
  const [giftRecipientEmail, setGiftRecipientEmail] = useState("");
  const [giftRecipientName, setGiftRecipientName] = useState("");
  const [giftCurrency, setGiftCurrency] = useState("usd");
  // Raffle Challenge: pot goes to the voted winner (challenge type only).
  const [raffleOn, setRaffleOn] = useState(false);
  const [raffleSplit, setRaffleSplit] = useState(0); // host's cut, %
  const [raffleVoteDays, setRaffleVoteDays] = useState(5); // voting window after close
  const [raffleGate, setRaffleGate] = useState(0); // hold reveal until this % entered
  const [raffleEntryFee, setRaffleEntryFee] = useState(0); // 0 = optional chip-in; >0 = $ to enter
  const [drawWeighted, setDrawWeighted] = useState(true); // Raffle Draw odds: weighted vs one-each
  const [drawAuto, setDrawAuto] = useState(true); // Raffle Draw: auto at close vs host draws live
  const [causeInput, setCauseInput] = useState(""); // thon/raffle: optional declared cause
  // Tournament (leaderboard): scoring direction + optional scorecard photo.
  const [tournDirection, setTournDirection] = useState<"low" | "high">("low");
  const [tournScorecard, setTournScorecard] = useState(false);
  // Hall of Fame: optionally gift-card the winner of ONE chosen award.
  const [hofPrize, setHofPrize] = useState(false);
  const [hofPrizeAward, setHofPrizeAward] = useState(0); // index into the awards list
  const [hofCustom, setHofCustom] = useState(""); // custom award being typed
  // Pledge Drive (Read-A-Thon…): unit, goal, suggested per-unit rate ($).
  const [pledgeUnit, setPledgeUnit] = useState("page");
  const [pledgeGoal, setPledgeGoal] = useState("");
  const [pledgeRate, setPledgeRate] = useState(""); // suggested $/unit, optional
  // Default the gift currency to the host's region (overridable below).
  useEffect(() => {
    setGiftCurrency(localeGiftCurrency());
  }, []);
  // Let members reply to each other anonymously after release (default off).
  const [allowAnonReplies, setAllowAnonReplies] = useState(false);
  // Occasion for a card. Recurring-by-nature ones: birthday, anniversary (fixed
  // dates that repeat yearly) and the floating holidays. A "once" card is a one-off
  // celebration (Retirement, Graduation, Farewell…) — fixed date, NO recurrence.
  const [occasion, setOccasion] = useState<
    | "birthday"
    | "anniversary"
    | "mothers_day"
    | "fathers_day"
    | "custom"
    | "once"
    | "wedding"
  >("birthday");
  // Free-text name for a one-off celebration (e.g. "Retirement").
  const [onceLabel, setOnceLabel] = useState("");
  // "Nth weekday of a month" pattern (Mother's Day = 2nd Sun May, etc.)
  const [nthWeek, setNthWeek] = useState(2); // 1-4, or 5 = last
  const [nthDow, setNthDow] = useState(0); // 0=Sun … 6=Sat
  const [nthMonth, setNthMonth] = useState(5); // 1-12
  const [pollOptions, setPollOptions] = useState(["", "", ""]);
  // Poll format: pick-an-option, a quick Yes/No, or open-ended text answers.
  const [pollFormat, setPollFormat] = useState<"multiple" | "yes_no" | "open">(
    "multiple"
  );
  // Truth or Dare: the host writes both; players commit blind, then see theirs.
  // Sign-up: claimable slots (label + how many people can take each).
  const [signupSlots, setSignupSlots] = useState<{ label: string; capacity: number }[]>([
    { label: "", capacity: 1 },
    { label: "", capacity: 1 },
  ]);
  // Party context — feeds the AI "what's still needed" suggestions.
  const [partyKind, setPartyKind] = useState("");
  const [partyKindOther, setPartyKindOther] = useState(""); // free-text when "Other"
  const [partyTheme, setPartyTheme] = useState(""); // e.g. "Traditional Thanksgiving"
  const [partyHeadcount, setPartyHeadcount] = useState("");
  const [partyDisposables, setPartyDisposables] = useState(false);
  const [partyWhen, setPartyWhen] = useState(""); // when the party is (free text)
  const [partyWhere, setPartyWhere] = useState(""); // where the party is
  const [partyRsvp, setPartyRsvp] = useState(true); // ask who's coming (RSVP)
  // Pre-enable a gift exchange (from a preset like the Christmas party).
  const [partyGiftex, setPartyGiftex] = useState<{
    byGender?: boolean;
    assign?: "self" | "person" | "gender";
  } | null>(null);
  const [truthPrompt, setTruthPrompt] = useState("");
  const [darePrompt, setDarePrompt] = useState("");
  // "Most Likely To…" awards (one engagement, many questions)
  const [questions, setQuestions] = useState<string[]>(["", "", ""]);
  // Care / Accountability: each CATEGORY holds several alternative questions, a
  // response kind, and how many to ask each time. Campfire locks a random pick per
  // occurrence (same for the whole group), so it varies month to month.
  const [careCategories, setCareCategories] = useState<
    { prompts: string[]; kind: "text" | "star"; ask: number }[]
  >([{ prompts: [""], kind: "text", ask: 1 }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Where to post: the current group by default, another group, or a new one.
  const [targetGroupId, setTargetGroupId] = useState<string>(groupId);
  const [makingNewGroup, setMakingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Smart default: if the destination group still has people pending on the
  // invite list, default "wait for all invited" ON (you can still flip it). A
  // brand-new group has no invites, so it stays off.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (makingNewGroup) {
        if (!cancelled) {
          setPendingForTarget(0);
          if (!waitTouched.current) setWaitForAllInvited(false);
        }
        return;
      }
      const { data } = await supabase.rpc("pending_invite_count", {
        _gid: targetGroupId,
      });
      if (!cancelled) {
        const p = (data as number) ?? 0;
        setPendingForTarget(p);
        if (!waitTouched.current) setWaitForAllInvited(p > 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetGroupId, makingNewGroup]);

  // Roster + pending invitees of the destination group (for the "hide from" picker).
  useEffect(() => {
    if (makingNewGroup) {
      setGroupMembers([]);
      setPendingInvitees([]);
      setExcludedIds([]);
      setExcludedEmails([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data }, { data: inv }] = await Promise.all([
        supabase
          .from("group_members")
          .select("user_id, display_name, profile:profiles(display_name)")
          .eq("group_id", targetGroupId),
        supabase
          .from("campfire_invitations")
          .select("email, name")
          .eq("group_id", targetGroupId)
          .eq("status", "pending"),
      ]);
      if (cancelled) return;
      if (data) {
        const list = (
          data as {
            user_id: string;
            display_name: string | null;
            profile: { display_name: string } | { display_name: string }[] | null;
          }[]
        )
          .filter((m) => m.user_id !== user?.id) // can't surprise yourself
          .map((m) => {
            const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
            return { user_id: m.user_id, name: m.display_name || p?.display_name || "Someone" };
          });
        setGroupMembers(list);
      }
      setPendingInvitees((inv as { email: string; name: string | null }[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [targetGroupId, makingNewGroup, user?.id]);

  const handleSelectType = (type: EngagementType) => {
    setSelectedType(type);
    if (type === "two_truths") {
      if (!title.trim()) setTitle("Two truths and a lie — what are yours?");
      if (!description.trim())
        setDescription("Share three statements about yourself — two true, one a lie. We'll all guess the lie!");
      setReveal("sealed"); // statements stay sealed until everyone's in
    }
    if (type === "baby_reveal") {
      if (!title.trim()) setTitle("Boy or girl? 🍼");
      if (!description.trim())
        setDescription("Suggest a boy name + a girl name, and guess the gender — all revealed on the big day!");
      setPollOptions(["Boy", "Girl"]);
      setReveal("sealed"); // guesses stay sealed until the reveal date
    }
    if (type === "most_likely") {
      if (!title.trim()) setTitle("Most Likely To… 🏆");
      if (!description.trim())
        setDescription("Vote a group-mate for each award. Sealed until the reveal!");
      setQuestions([
        "Most likely to change the world",
        "Always makes everyone laugh",
        "The friend you can always count on",
      ]);
      setReveal("sealed");
    }
    if (type === "hall_of_fame") {
      if (!title.trim()) setTitle("Hall of Fame Superlatives 🏅");
      if (!description.trim())
        setDescription("Vote a group-mate for each award — winners revealed together!");
      // Seed a few popular awards; the bubble picker handles the rest.
      setQuestions(["Best Dressed", "Funniest", "Kindest"]);
      setReveal("sealed");
    }
    if (type === "birthday") {
      if (!title.trim()) setTitle("Happy {age} Birthday! 🎂");
      if (!description.trim())
        setDescription("Sign the card with your birthday wishes — it opens on the big day!");
      setReveal("sealed");
    }
    if (type === "scavenger_hunt") {
      if (!title.trim()) setTitle("Scavenger Hunt 🔍");
      if (!description.trim())
        setDescription("Find each one — snap a photo or type your answer. Any order!");
      setQuestions([
        "Something that represents teamwork",
        "The oldest thing you can find",
        "A word that starts with Q",
      ]);
      setReveal("sealed");
    }
    if (type === "tournament") {
      if (!title.trim()) setTitle("Tournament ⛳");
      if (!description.trim())
        setDescription("Post your score each round — best total wins. Play from anywhere!");
      setQuestions(["Round 1", "Round 2", "Round 3"]);
      setReveal("sealed");
    }
    if (type === "raffle_draw") {
      if (!title.trim()) setTitle("Family Raffle 🎟️");
      if (!description.trim())
        setDescription("Chip in for a chance to win the pot — a winner is drawn at the end!");
      setReveal("sealed");
    }
    if (type === "pledge_drive") {
      if (!title.trim()) setTitle("Read-A-Thon 🎗️");
      if (!description.trim())
        setDescription(
          "Sponsor my challenge! Pledge a lump sum or per page — you only pay for what's achieved."
        );
      setPledgeUnit("page");
      setPledgeGoal("100");
      setReveal("sealed");
    }
    if (type === "accountability") {
      if (!title.trim()) setTitle("Accountability check-in 🙏");
      if (!description.trim())
        setDescription("Answer honestly — set responses to blind if you'd like.");
      setCareCategories([
        {
          kind: "star",
          ask: 1,
          prompts: [
            "Have you kept up with daily prayer/reading?",
            "Have you guarded your heart and eyes this week?",
          ],
        },
        {
          kind: "star",
          ask: 1,
          prompts: [
            "Have you invested in your closest relationships?",
            "Have you been honest and above reproach?",
          ],
        },
      ]);
      setReveal("sealed");
    }
    if (type === "care") {
      if (!title.trim()) setTitle("Weekly care check-in 🤝");
      if (!description.trim())
        setDescription(
          "Fill in any or all of the sections below — share as much or as little as you'd like."
        );
      setCareCategories([
        {
          kind: "star",
          ask: 1,
          prompts: ["How are you doing this week? (1–5)", "How's your energy this week? (1–5)"],
        },
        {
          kind: "text",
          ask: 1,
          prompts: [
            "Where have you seen God at work in your life?",
            "What has God been teaching you lately?",
          ],
        },
        {
          kind: "text",
          ask: 1,
          prompts: [
            "Anything you'd value prayer or support for?",
            "Where do you most need encouragement right now?",
          ],
        },
        {
          kind: "text",
          ask: 1,
          prompts: ["A praise — where have you seen God at work?", "Share a verse that's stood out."],
        },
      ]);
      // Responses surface as they come, so the host can follow up right away (and
      // a big group never stalls waiting on everyone).
      setReveal("as_they_come");
    }
    setStep("details");
  };

  // Pre-select a type from ?type=… (e.g. the dashboard's "Trending now" chip).
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || typeof window === "undefined") return;
    const t = new URLSearchParams(window.location.search).get("type");
    if (t && Object.prototype.hasOwnProperty.call(ENGAGEMENT_TYPES, t)) {
      preselected.current = true;
      handleSelectType(t as EngagementType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Card occasion → default title + description (pre-filled, still editable).
  const OCCASION_TITLE: Record<typeof occasion, string> = {
    birthday: "Happy {age} Birthday! 🎂",
    anniversary: "Happy Anniversary! 💍",
    wedding: "Wishing you every happiness! 💒",
    once: "Congratulations! 🎉",
    mothers_day: HOLIDAY_PRESETS.mothers_day.titleHint,
    fathers_day: HOLIDAY_PRESETS.fathers_day.titleHint,
    custom: "Happy Holidays! 🗓️",
  };
  const OCCASION_DESC: Record<typeof occasion, string> = {
    birthday: "Sign the card with your birthday wishes — it opens on the big day!",
    anniversary:
      "Sign the card with your anniversary wishes — it opens on the big day!",
    wedding:
      "Sign the card with your best wishes for the happy couple — it opens on the wedding day!",
    once: "Sign the card with your wishes — it opens on the big day!",
    mothers_day: "Sign the card with a message for Mom — it opens on Mother's Day!",
    fathers_day: "Sign the card with a message for Dad — it opens on Father's Day!",
    custom: "Sign the card — it opens on the day!",
  };
  const titleDefaults = new Set(Object.values(OCCASION_TITLE));
  const descDefaults = new Set(Object.values(OCCASION_DESC));

  // Pick a celebration occasion: pre-fill title + description (only overwriting blanks
  // or a previous occasion's default, so a host's own wording is never clobbered).
  const applyOccasion = (value: typeof occasion) => {
    setOccasion(value);
    if (value === "mothers_day" || value === "fathers_day") {
      const p = HOLIDAY_PRESETS[value];
      setNthWeek(p.nth.week);
      setNthDow(p.nth.weekday);
      setNthMonth(p.nth.month);
    }
    setTitle((t) =>
      !t.trim() || t.includes("{age}") || titleDefaults.has(t)
        ? OCCASION_TITLE[value]
        : t
    );
    setDescription((d) =>
      !d.trim() || descDefaults.has(d) ? OCCASION_DESC[value] : d
    );
  };

  const applyTemplate = (t: EngagementTemplate) => {
    setSelectedType(t.type);
    setTitle(t.title);
    setDescription(t.description ?? "");
    if (t.type === "poll") {
      const opts = t.options ?? [];
      setPollOptions(opts.length >= 2 ? opts : [...opts, "", ""].slice(0, 3));
    }
    // Pre-fill check-in / most-likely / scavenger items and any reveal override.
    if (t.type === "care" || t.type === "accountability") {
      // Each template question becomes a single-prompt category (ask 1).
      const cats = (t.careQuestions ?? []).map((q) => ({
        prompts: [q.prompt],
        kind: q.kind,
        ask: 1,
      }));
      const fromStrings = (t.questions ?? []).map((q) => ({
        prompts: [q],
        kind: (t.type === "accountability" ? "star" : "text") as "text" | "star",
        ask: 1,
      }));
      const merged = [...cats, ...fromStrings];
      if (merged.length) setCareCategories(merged);
    } else if (t.questions && t.questions.length) {
      setQuestions(t.questions);
    }
    // Card templates can pre-select the occasion (e.g. a one-time year-end card).
    if (t.type === "birthday" && t.occasion) {
      setOccasion(t.occasion);
      if (t.onceLabel) setOnceLabel(t.onceLabel);
    }
    // Sign-up templates pre-fill the claimable slots + party type.
    if (t.type === "signup") {
      if (t.slots && t.slots.length) setSignupSlots(t.slots.map((s) => ({ ...s })));
      if (t.partyKind) setPartyKind(t.partyKind);
      setPartyGiftex(t.giftExchange ?? null);
    }
    if (t.raffle) setRaffleOn(true);
    if (t.reveal) setReveal(t.reveal);
    setStep("details");
  };

  // Deep-link: apply a template from ?template=ID (e.g. the dashboard's seasonal card).
  const tplApplied = useRef(false);
  useEffect(() => {
    if (tplApplied.current || typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("template");
    if (!id) return;
    for (const pack of TEMPLATE_PACKS) {
      const tpl = pack.templates.find((t) => t.id === id);
      if (tpl) {
        tplApplied.current = true;
        applyTemplate(tpl);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async () => {
    if (!selectedType || !title.trim()) return;
    setCreating(true);
    setError("");

    const config: Record<string, unknown> = {};

    // Type-specific config
    if (selectedType === "baby_reveal") {
      config.options = ["Boy", "Girl"]; // the gender guess
      // Who reveals the name + gender — the host, or a designated member (the parent).
      config.babyReveal = { revealerUserId: babyRevealerId || user?.id || null };
    } else if (selectedType === "poll") {
      config.format = pollFormat;
      if (pollFormat === "open") {
        // Open-ended: the inputs are the question(s) people type answers to.
        const qs = pollOptions.map((o) => o.trim()).filter(Boolean);
        if (qs.length < 1) {
          setError("Add at least one open question.");
          setCreating(false);
          return;
        }
        config.questions = qs;
        config.options = [];
      } else if (pollFormat === "yes_no") {
        config.options = ["Yes", "No"];
      } else {
        const opts = pollOptions.filter((o) => o.trim());
        if (opts.length < 2) {
          setError("Add at least 2 options for your poll.");
          setCreating(false);
          return;
        }
        config.options = opts;
      }
    }

    // Baby Reveal auto-opens on a date — a reveal date is required.
    if (selectedType === "baby_reveal" && !deadline) {
      setError("Pick the reveal date — that's when it unseals.");
      setCreating(false);
      return;
    }

    const isBirthday = selectedType === "birthday";
    // Floating-date holiday cards (Mother's/Father's Day, custom) compute their date
    // from an Nth-weekday pattern. Birthday / anniversary / one-time use a fixed date.
    const isNthCard =
      isBirthday &&
      (occasion === "mothers_day" ||
        occasion === "fathers_day" ||
        occasion === "custom");
    const isFixedDateCard =
      isBirthday &&
      (occasion === "birthday" ||
        occasion === "anniversary" ||
        occasion === "once" ||
        occasion === "wedding");
    // A floating "Nth weekday" pattern, from a holiday card OR a general yearly_nth pick.
    const nthPattern: NthWeekday | null = isNthCard
      ? occasion === "custom"
        ? { week: nthWeek, weekday: nthDow, month: nthMonth }
        : HOLIDAY_PRESETS[occasion as "mothers_day" | "fathers_day"].nth
      : !isBirthday && recurrence === "yearly_nth"
      ? { week: nthWeek, weekday: nthDow, month: nthMonth }
      : null;

    // A fixed-date card (birthday/anniversary/one-time) needs its date; a holiday
    // computes its own.
    if (isFixedDateCard && !deadline) {
      setError(
        occasion === "anniversary"
          ? "Set the anniversary date — that's the day it reveals."
          : occasion === "wedding"
          ? "Set the wedding date — that's the day it reveals."
          : occasion === "once"
          ? "Set the date — that's the day it reveals."
          : "Set the birthday — that's the day it reveals."
      );
      setCreating(false);
      return;
    }

    // Effective reveal date: a floating pattern resolves to its next occurrence.
    const effectiveDeadline = nthPattern
      ? nextNthWeekday(nthPattern)
      : deadline
      ? new Date(deadline)
      : undefined;

    // A sealed engagement with no chosen date gets a gentle 7-day soft deadline, so
    // stragglers still get nudged (final call at ~24h) and it can't hang unrevealed
    // forever. Cards / baby reveals already carry their own date.
    const sealedReveal =
      selectedType === "two_truths" ||
      selectedType === "most_likely" ||
      selectedType === "hall_of_fame" ||
      selectedType === "accountability" ||
      selectedType === "scavenger_hunt" ||
      selectedType === "tournament" ||
      selectedType === "pledge_drive" ||
      selectedType === "raffle_draw" ||
      reveal === "sealed";
    // A recurring engagement (e.g. a monthly check-in) needs a close date so it
    // reveals and the cron spawns the next instance — otherwise it just stays open
    // forever and never cycles. Default it to the repeat interval.
    const recurDays =
      recurrence === "daily"
        ? 1
        : recurrence === "weekly"
        ? 7
        : recurrence === "monthly"
        ? 30
        : 0;

    const DAY = 86400000;
    // Monthly Nth-weekday release (e.g. 2nd Sunday at 4pm): the engagement opens +
    // emails the group at that moment, stays open for the chosen window, then closes.
    const isMonthlyNth = recurrence === "monthly_nth";
    const [recurHour, recurMin] = recurTime.split(":").map((n) => parseInt(n, 10));
    const monthlyFirstOpen = isMonthlyNth
      ? nextMonthlyNthWeekday(nthWeek, nthDow, recurHour || 16, recurMin || 0, new Date())
      : null;

    const finalDeadline =
      isMonthlyNth && monthlyFirstOpen
        ? new Date(monthlyFirstOpen.getTime() + (recurWindowDays || 3) * DAY)
        : effectiveDeadline
        ? effectiveDeadline
        : recurDays > 0 && !isBirthday
        ? new Date(Date.now() + recurDays * DAY)
        : sealedReveal && !isBirthday && selectedType !== "baby_reveal"
        ? // 2 Truths plays faster, so give it a tighter default window.
          new Date(Date.now() + (selectedType === "two_truths" ? 3 : 7) * DAY)
        : effectiveDeadline;

    // Auto-open scheduling: cards + yearly events open a lead time before the date;
    // a monthly Nth release opens at its scheduled time; and any sealed engagement
    // with a reveal date can opt to "release in advance" by N days.
    const schedulesOpen =
      isBirthday ||
      recurrence === "yearly_nth" ||
      isMonthlyNth ||
      (releaseEarly && !!effectiveDeadline);
    const scheduledOpenAt =
      isMonthlyNth && monthlyFirstOpen
        ? monthlyFirstOpen.toISOString()
        : (isBirthday || recurrence === "yearly_nth" || releaseEarly) && effectiveDeadline
        ? new Date(effectiveDeadline.getTime() - (leadDays || 14) * DAY).toISOString()
        : null;

    if (selectedType === "care" || selectedType === "accountability") {
      // Categories of alternative questions + how many to ask each time. Store the
      // whole pool, and lock in a random pick per category for this occurrence.
      const pool = careCategories
        .map((c) => ({
          kind: c.kind,
          prompts: c.prompts.map((p) => p.trim()).filter(Boolean),
          ask: Math.max(1, Math.round(c.ask) || 1),
        }))
        .filter((c) => c.prompts.length > 0);
      if (pool.length < 1) {
        setError("Add at least one question for people to answer.");
        setCreating(false);
        return;
      }
      config.questionPool = pool;
      config.questions = selectPoolQuestions(pool, selectedType);
    } else if (
      selectedType === "most_likely" ||
      selectedType === "hall_of_fame" ||
      selectedType === "scavenger_hunt" ||
      selectedType === "tournament"
    ) {
      const qs = questions.map((q) => q.trim()).filter(Boolean);
      if (qs.length < 1) {
        setError(
          selectedType === "scavenger_hunt"
            ? "Add at least one item to find."
            : selectedType === "tournament"
            ? "Add at least one round to score."
            : selectedType === "hall_of_fame"
            ? "Pick at least one award (tap the bubbles)."
            : "Add at least one award (a “Most likely to…” question)."
        );
        setCreating(false);
        return;
      }
      config.questions = qs;
      if (selectedType === "tournament") {
        config.tournament = { direction: tournDirection, scorecard: tournScorecard };
      }
      // Hall of Fame: the chosen award whose winner gets the gift-card pot.
      if (selectedType === "hall_of_fame" && hofPrize) {
        config.hofGiftAward = Math.min(Math.max(0, hofPrizeAward), qs.length - 1);
      }
    }

    if (selectedType === "challenge") {
      config.media_type = "photo"; // Default, could be made selectable
    }

    if (selectedType === "pledge_drive") {
      const unit = pledgeUnit.trim() || "unit";
      const goal = Math.round(Number(pledgeGoal) || 0);
      if (goal < 1) {
        setError("Set a goal (e.g. read 100 pages, walk 10 km).");
        setCreating(false);
        return;
      }
      if (!giftRecipientEmail.trim()) {
        setError(
          "Add the recipient's email — that's where the funds (gift card) are sent."
        );
        setCreating(false);
        return;
      }
      if (!deadline) {
        setError("Set a date — that's when the result is posted and pledges settle.");
        setCreating(false);
        return;
      }
      config.pledge = { unit, goalUnits: goal };
    }

    if (selectedType === "raffle_draw") {
      if (!deadline) {
        setError("Set a date — that's the backstop for drawing the winner.");
        setCreating(false);
        return;
      }
      config.raffle = {
        on: true,
        draw: true,
        drawWeighted,
        autoDraw: drawAuto,
        hostSplitPct: Math.min(90, Math.max(0, Math.round(raffleSplit) || 0)),
        voteDays: 0, // drawn at the deadline (or earlier by the host)
        participationGate: 0,
        entryFeeCents: 0,
      };
    }

    if (selectedType === "signup") {
      const slots = signupSlots
        .map((s) => ({
          label: s.label.trim(),
          // 0 = "any number" (unlimited); otherwise at least 1.
          capacity: s.capacity === 0 ? 0 : Math.max(1, s.capacity || 1),
        }))
        .filter((s) => s.label);
      const resolvedKind =
        partyKind === "Other" ? partyKindOther.trim() : partyKind.trim();
      // A host needn't list everything — either set a party type (we'll suggest
      // what to bring) or add at least one slot of their own.
      if (slots.length < 1 && !resolvedKind) {
        setError(
          "Pick a party type so we can suggest what's needed — or add a slot yourself."
        );
        setCreating(false);
        return;
      }
      config.slots = slots;
      if (resolvedKind) config.partyKind = resolvedKind;
      if (partyTheme.trim()) config.partyTheme = partyTheme.trim();
      if (partyHeadcount.trim())
        config.headcount = Math.max(1, parseInt(partyHeadcount, 10) || 0);
      config.disposables = partyDisposables;
      if (partyWhen.trim()) config.partyWhen = partyWhen.trim();
      if (partyWhere.trim()) config.partyWhere = partyWhere.trim();
      config.rsvp = partyRsvp;
      if (partyGiftex) {
        config.giftex = {
          on: true,
          byGender: !!partyGiftex.byGender,
          assign: partyGiftex.assign ?? "person",
        };
      }
    }

    if (selectedType === "truth_or_dare") {
      const tp = truthPrompt.trim();
      const dp = darePrompt.trim();
      if (!tp || !dp) {
        setError("Write both a Truth prompt and a Dare prompt.");
        setCreating(false);
        return;
      }
      config.truthPrompt = tp;
      config.darePrompt = dp;
    }

    // Floating recurrence (Nth weekday) — store the pattern so the cron rolls it
    // forward to next year's date, plus an occasion label for holiday cards.
    if (nthPattern) {
      config.recurrence_nth = nthPattern;
      if (isNthCard) {
        config.occasion =
          occasion === "custom"
            ? describeNthWeekday(nthPattern)
            : HOLIDAY_PRESETS[occasion as "mothers_day" | "fathers_day"].label;
      }
    } else if (occasion === "anniversary") {
      config.occasion = "Anniversary";
    } else if (occasion === "wedding") {
      config.occasion = "Wedding";
    } else if (occasion === "once") {
      // The free-text name (Retirement, etc.) — also drives the 🎉 icon + copy.
      config.occasion = onceLabel.trim() || "Celebration";
    }

    // Resolve the destination group — make a new one first if requested.
    let destGroupId = targetGroupId;
    if (makingNewGroup) {
      if (!newGroupName.trim()) {
        setError("Give your new group a name.");
        setCreating(false);
        return;
      }
      const { group, error: gErr } = await createGroup(newGroupName.trim(), "", "🔥");
      if (gErr || !group) {
        setError(gErr || "Couldn't create the group.");
        setCreating(false);
        return;
      }
      destGroupId = group.id;
    }

    if (giftEnabled && !giftRecipientEmail.trim()) {
      setError("Add the recipient's email — that's where the gift card is sent.");
      setCreating(false);
      return;
    }

    // A prize contest (photo Challenge or Scavenger Hunt) pools toward the voted
    // winner; it needs a closing date (entries end + voting begins there) but no
    // preset recipient.
    const isTournament = selectedType === "tournament";
    const challengeRaffle =
      (selectedType === "challenge" ||
        selectedType === "scavenger_hunt" ||
        isTournament) &&
      raffleOn;
    if (challengeRaffle && !deadline) {
      setError(
        isTournament
          ? "Set a closing date — that's when scores lock and the pot is awarded."
          : "Set a closing date — that's when entries end and voting begins."
      );
      setCreating(false);
      return;
    }
    if (challengeRaffle) {
      config.raffle = {
        on: true,
        hostSplitPct: Math.min(90, Math.max(0, Math.round(raffleSplit) || 0)),
        // A tournament is decided by score, not votes → award at close (no window).
        voteDays: isTournament ? 0 : Math.min(30, Math.max(1, Math.round(raffleVoteDays) || 5)),
        participationGate: raffleGate || 0,
        entryFeeCents: Math.max(0, Math.round(raffleEntryFee) || 0),
      };
    }

    // Optional declared cause (thons + raffles). Informational — Campfire pays the
    // host/recipient, who is responsible for forwarding it to the cause.
    if (
      causeInput.trim() &&
      (selectedType === "pledge_drive" ||
        selectedType === "raffle_draw" ||
        challengeRaffle)
    ) {
      config.cause = causeInput.trim().slice(0, 120);
    }

    // Monthly Nth-weekday release pattern — the cron rolls this forward each month.
    if (isMonthlyNth) {
      config.monthlyNth = {
        week: nthWeek,
        weekday: nthDow,
        hour: recurHour || 16,
        minute: recurMin || 0,
        windowDays: recurWindowDays || 3,
      };
    }

    const result = await create({
      groupId: destGroupId,
      type: selectedType,
      title: title.trim(),
      description: description.trim() || undefined,
      config,
      deadline: finalDeadline,
      reveal: challengeRaffle
        ? "sealed" // entries stay sealed so voting on them is fair
        : selectedType === "two_truths" ||
          selectedType === "baby_reveal" ||
          selectedType === "most_likely" ||
          selectedType === "hall_of_fame" ||
          selectedType === "accountability" ||
          selectedType === "scavenger_hunt" ||
          selectedType === "tournament" ||
          selectedType === "pledge_drive" ||
          selectedType === "raffle_draw" ||
          isBirthday
        ? "sealed"
        : selectedType === "signup"
        ? "as_they_come" // a sign-up is live — everyone sees what's claimed
        : reveal,
      is_blind: isBlind,
      // Every card occasion repeats yearly (birthday, anniversary, Mother's/Father's
      // Day, custom holiday) EXCEPT a one-time card, which never recurs.
      recurrence_rule: isBirthday
        ? occasion === "once" || occasion === "wedding"
          ? undefined
          : "yearly"
        : recurrence === "yearly_nth"
        ? "yearly"
        : recurrence === "monthly_nth"
        ? "monthly" // stored as monthly; the Nth-weekday detail lives in config.monthlyNth
        : recurrence === "none"
        ? undefined
        : recurrence,
      notify: true, // launching always notifies the group
      // Birthday + Baby Reveal always hold until the date; a raffle holds too (the
      // cron reveals it on the date or once the participation gate is met). Others
      // only when opted in.
      hold_until_deadline:
        isBirthday ||
        selectedType === "baby_reveal" ||
        selectedType === "tournament" ||
        selectedType === "pledge_drive" ||
        selectedType === "raffle_draw" ||
        isMonthlyNth ||
        challengeRaffle
          ? true
          : reveal === "sealed" && !!deadline && holdUntilDeadline,
      // Birthday: schedule the auto-open and store the age basis.
      scheduled_open_at: scheduledOpenAt,
      lead_days: schedulesOpen ? leadDays || 14 : undefined,
      // The anchor year for {age}: a birthday's birth year, or an anniversary /
      // one-time card's start year. Floating holidays don't carry one.
      birth_year:
        isBirthday &&
        (occasion === "birthday" ||
          occasion === "anniversary" ||
          occasion === "once") &&
        birthYear.trim()
          ? parseInt(birthYear, 10)
          : null,
      // Wait for the full invite list to join + respond (sealed only).
      wait_for_all_invited:
        (selectedType === "two_truths" || reveal === "sealed") && waitForAllInvited,
      // Group gift — collect contributions toward a card for the recipient. A raffle
      // also pools, but the recipient (winner) is resolved at award time → no email.
      gift_enabled:
        giftEnabled ||
        challengeRaffle ||
        (selectedType === "hall_of_fame" && hofPrize) ||
        selectedType === "pledge_drive" ||
        selectedType === "raffle_draw",
      gift_recipient_email:
        challengeRaffle || selectedType === "hall_of_fame"
          ? null // winner (and their email) is resolved at award time
          : giftEnabled || selectedType === "pledge_drive"
          ? giftRecipientEmail.trim() || null
          : null,
      gift_recipient_name:
        challengeRaffle || selectedType === "hall_of_fame"
          ? null
          : giftEnabled || selectedType === "pledge_drive"
          ? giftRecipientName.trim() || null
          : null,
      gift_currency: giftCurrency,
      // Keep responses visible only to each author + the host.
      private_to_host: privateToHost,
      // Let members reply to each other anonymously after release.
      allow_anon_replies: allowAnonReplies,
      // Let members (not just the host) invite others to this engagement.
      allow_member_invites: allowMemberInvites,
      // Surprise: hide it from these members / invitees until the reveal.
      excluded_user_ids: makingNewGroup ? [] : excludedIds,
      excluded_emails: makingNewGroup ? [] : excludedEmails,
      cover_image_urls: coverUrls,
      // Show a random one from the pool (a fresh pick each year for a birthday).
      cover_image_url:
        coverUrls.length > 0
          ? coverUrls[Math.floor(Math.random() * coverUrls.length)]
          : undefined,
    });

    if (result.error) {
      setError(result.error);
      setCreating(false);
    } else if (result.engagement) {
      // Created as a DRAFT — the creator reviews it and hits Launch when ready.
      router.push(`/campfirelive/group/${destGroupId}/engagement/${result.engagement.id}`);
    }
  };

  // Shared "[2nd] [Sunday] of [May]" picker + a live next-occurrence preview.
  const renderNthPicker = () => {
    const pattern: NthWeekday = { week: nthWeek, weekday: nthDow, month: nthMonth };
    const next = nextNthWeekday(pattern);
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={nthWeek}
            onChange={(e) => setNthWeek(parseInt(e.target.value, 10))}
            className="rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-orange-500"
          >
            {[1, 2, 3, 4, 5].map((w) => (
              <option key={w} value={w}>
                {ORDINAL_WEEK[w] || `${w}th`}
              </option>
            ))}
          </select>
          <select
            value={nthDow}
            onChange={(e) => setNthDow(parseInt(e.target.value, 10))}
            className="rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-orange-500"
          >
            {WEEKDAY_NAMES.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
          <span className="text-slate-500">of</span>
          <select
            value={nthMonth}
            onChange={(e) => setNthMonth(parseInt(e.target.value, 10))}
            className="rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-orange-500"
          >
            {MONTH_NAMES.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">
          Next:{" "}
          <span className="font-medium text-slate-700">
            {next.toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>{" "}
          · repeats every year.
        </p>
      </div>
    );
  };

  // "[2nd] [Sunday] at [4:00pm]" picker for a monthly release + how long it stays
  // open, with a live next-occurrence preview.
  const renderMonthlyNthPicker = () => {
    const [h, m] = recurTime.split(":").map((n) => parseInt(n, 10));
    const next = nextMonthlyNthWeekday(nthWeek, nthDow, h || 16, m || 0, new Date());
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">The</span>
          <select
            value={nthWeek}
            onChange={(e) => setNthWeek(parseInt(e.target.value, 10))}
            className="rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-orange-500"
          >
            {[1, 2, 3, 4, 5].map((w) => (
              <option key={w} value={w}>
                {ORDINAL_WEEK[w] || `${w}th`}
              </option>
            ))}
          </select>
          <select
            value={nthDow}
            onChange={(e) => setNthDow(parseInt(e.target.value, 10))}
            className="rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-orange-500"
          >
            {WEEKDAY_NAMES.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
          <span className="text-slate-500">of each month at</span>
          <input
            type="time"
            value={recurTime}
            onChange={(e) => setRecurTime(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-orange-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Stays open for</span>
          <select
            value={recurWindowDays}
            onChange={(e) => setRecurWindowDays(parseInt(e.target.value, 10))}
            className="rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-orange-500"
          >
            {[1, 2, 3, 4, 5, 7, 10, 14].map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
          <span className="text-slate-500">before results reveal.</span>
        </div>
        <p className="text-xs text-slate-500">
          Opens &amp; emails the group{" "}
          <span className="font-medium text-slate-700">
            {next.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}{" "}
            at{" "}
            {next.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>{" "}
          · repeats every month.
        </p>
      </div>
    );
  };

  // Card header copy adapts to the occasion — a Teacher Appreciation (or any
  // one-time) card isn't a "birthday" and doesn't recur.
  const isCardType = selectedType === "birthday";
  const cardHeaderLabel = !isCardType
    ? null
    : occasion === "birthday"
    ? "Birthday"
    : occasion === "anniversary"
    ? "Anniversary"
    : occasion === "mothers_day"
    ? "Mother's Day"
    : occasion === "fathers_day"
    ? "Father's Day"
    : occasion === "wedding"
    ? "Wedding"
    : occasion === "custom"
    ? "Holiday card"
    : `${onceLabel.trim() || "Celebration"} card`;
  const cardHeaderIcon = !isCardType
    ? null
    : occasion === "anniversary"
    ? "💍"
    : occasion === "wedding"
    ? "💒"
    : occasion === "mothers_day"
    ? "💐"
    : occasion === "fathers_day"
    ? "👔"
    : occasion === "custom"
    ? "🗓️"
    : occasion === "once"
    ? "🎉"
    : "🎂";
  const cardRecurs = isCardType && occasion !== "once" && occasion !== "wedding";
  const cardRecipientNoun =
    occasion === "birthday"
      ? "the birthday person"
      : occasion === "wedding"
      ? "the happy couple"
      : "the recipient";
  const cardHeaderDesc = `A surprise card everyone signs — hidden from ${cardRecipientNoun}, opens before the day and reveals on it.${
    cardRecurs ? " Runs every year." : ""
  }`;

  return (
    <div>
      <Link
        href={`/campfirelive/group/${groupId}`}
        className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block"
      >
        ← Back to group
      </Link>

      <h1 className="text-2xl font-extrabold text-slate-900 mb-6">New Engagement</h1>

      {/* Step 1: Choose Type */}
      {step === "type" && (
        <div>
          {/* Templates — start from a ready-made one */}
          <div className="mb-8 rounded-2xl border border-orange-200 bg-orange-50/50 p-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">
              ⚡ Start from a template
            </p>
            <div className="space-y-4">
              {TEMPLATE_PACKS.map((pack) => (
                <div key={pack.id}>
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">
                    {pack.emoji} {pack.name}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pack.templates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        title={t.title}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-orange-300 hover:bg-orange-50"
                      >
                        {ENGAGEMENT_TYPES[t.type].icon} {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-slate-500 mb-4">…or start from scratch — what kind of engagement?</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(Object.entries(ENGAGEMENT_TYPES) as [EngagementType, typeof ENGAGEMENT_TYPES[EngagementType]][])
              // "Most Likely To…" is now folded into Hall of Fame (a superset), so it's
              // hidden from the picker. Existing ones keep working; remove this filter
              // to bring the standalone type back.
              .filter(([type]) => type !== "most_likely")
              .map(
              ([type, meta]) => (
                <button
                  key={type}
                  onClick={() => handleSelectType(type)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
                >
                  <div className="text-3xl mb-2">{meta.icon}</div>
                  <div className="font-bold text-sm text-slate-900">{meta.label}</div>
                  <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {meta.description}
                  </div>
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Step 2: Details */}
      {step === "details" && selectedType && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <span className="text-3xl">
              {isCardType ? cardHeaderIcon : ENGAGEMENT_TYPES[selectedType].icon}
            </span>
            <div>
              <h2 className="font-bold text-slate-900">
                {isCardType ? cardHeaderLabel : ENGAGEMENT_TYPES[selectedType].label}
              </h2>
              <button
                onClick={() => setStep("type")}
                className="text-xs text-orange-600 underline"
              >
                Change type
              </button>
            </div>
          </div>

          {/* How this type works + what each person sees */}
          <div className="mb-6 max-w-lg rounded-2xl border border-orange-200 bg-orange-50/50 p-4">
            <p className="text-sm text-slate-700">
              {isCardType
                ? cardHeaderDesc
                : TYPE_HELP[selectedType]?.how ??
                  ENGAGEMENT_TYPES[selectedType].description}
            </p>
            {TYPE_HELP[selectedType]?.sees && (
              <p className="mt-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-600">👀 Each person sees:</span>{" "}
                {TYPE_HELP[selectedType]?.sees}
              </p>
            )}
          </div>

          <div className="space-y-4 max-w-lg">
            {/* Posting target — this group, another group, or a brand-new one */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Posting to
              </label>
              <select
                value={makingNewGroup ? "__new__" : targetGroupId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setMakingNewGroup(true);
                  } else {
                    setMakingNewGroup(false);
                    setTargetGroupId(e.target.value);
                  }
                }}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none bg-white"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.avatar_emoji} {g.name}
                    {g.id === groupId ? " (this group)" : ""}
                  </option>
                ))}
                <option value="__new__">➕ New group…</option>
              </select>
              {makingNewGroup && (
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Name your new group (e.g. Book Club)"
                  autoFocus
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                />
              )}
              <p className="mt-1 text-xs text-slate-500">
                Everyone in the chosen group is emailed to respond the moment you launch.
              </p>
            </div>

            {/* Card occasion: pre-fills the title + description, still editable below */}
            {selectedType === "birthday" && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  What&apos;s the occasion?
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(
                    [
                      { value: "birthday", label: "🎂 Birthday" },
                      { value: "anniversary", label: "💍 Anniversary" },
                      { value: "wedding", label: "💒 Wedding" },
                      { value: "once", label: "🎉 One-time" },
                      { value: "mothers_day", label: "💐 Mother's Day" },
                      { value: "fathers_day", label: "👔 Father's Day" },
                      { value: "custom", label: "🗓️ Holiday" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => applyOccasion(o.value)}
                      className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                        occasion === o.value
                          ? "border-orange-500 bg-orange-50 text-slate-900"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  selectedType === "poll"
                    ? "e.g. What should we eat on Saturday?"
                    : selectedType === "challenge"
                    ? "e.g. Best sunset photo this week"
                    : "Give your engagement a title"
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Description <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add more context or rules..."
                rows={3}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none resize-none"
              />
            </div>

            {/* Poll / Baby Reveal: the choices */}
            {/* Poll format: multiple choice / yes-no / open-ended */}
            {selectedType === "poll" && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Answer format
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { v: "multiple", label: "Multiple choice", sub: "Pick an option" },
                      { v: "yes_no", label: "Yes / No", sub: "One tap" },
                      { v: "open", label: "Open-ended", sub: "Type an answer" },
                    ] as const
                  ).map((o) => {
                    const on = pollFormat === o.v;
                    return (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => setPollFormat(o.v)}
                        className={`rounded-xl border px-2 py-2 text-center text-xs transition ${
                          on
                            ? "border-orange-500 bg-orange-50 text-slate-900"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <div className="font-semibold">{o.label}</div>
                        <div className={on ? "text-orange-500" : "text-slate-400"}>
                          {o.sub}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {pollFormat === "yes_no" && (
                  <p className="mt-2 text-xs text-slate-500">
                    People answer with a quick <span className="font-semibold">Yes</span> or{" "}
                    <span className="font-semibold">No</span>.
                  </p>
                )}
                {pollFormat === "open" && (
                  <p className="mt-2 text-xs text-slate-500">
                    Add one or more open questions — people type an answer to each.
                  </p>
                )}
              </div>
            )}

            {(() => {
              const isOpen = selectedType === "poll" && pollFormat === "open";
              const show =
                selectedType === "baby_reveal" ||
                (selectedType === "poll" &&
                  (pollFormat === "multiple" || pollFormat === "open"));
              if (!show) return null;
              const label =
                selectedType === "baby_reveal"
                  ? "Choices to guess between"
                  : isOpen
                  ? "Open questions"
                  : "Poll Options";
              const minKeep = isOpen ? 1 : 2; // open polls can have a single question
              return (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {label}
                  </label>
                  {pollOptions.map((opt, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const next = [...pollOptions];
                          next[i] = e.target.value;
                          setPollOptions(next);
                        }}
                        placeholder={`${isOpen ? "Question" : "Option"} ${i + 1}`}
                        className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                      {pollOptions.length > minKeep && (
                        <button
                          onClick={() =>
                            setPollOptions(pollOptions.filter((_, j) => j !== i))
                          }
                          className="text-slate-400 hover:text-red-500 px-2"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {pollOptions.length < 12 && (
                    <button
                      onClick={() => setPollOptions([...pollOptions, ""])}
                      className="text-sm text-orange-600 font-medium"
                    >
                      {isOpen ? "+ Add question" : "+ Add option"}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Sign-up: party context (powers AI "what's still needed" suggestions) */}
            {selectedType === "signup" && (
              <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Party type <span className="text-slate-400">(optional)</span>
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {["Snacks", "Full meal", "Dessert", "BBQ", "Drinks & apps", "Potluck", "Other"].map(
                    (k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPartyKind(k)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                          partyKind === k
                            ? "border-cyan-500 bg-cyan-500 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-cyan-300"
                        }`}
                      >
                        {k}
                      </button>
                    )
                  )}
                </div>
                {partyKind === "Other" && (
                  <input
                    type="text"
                    value={partyKindOther}
                    onChange={(e) => setPartyKindOther(e.target.value)}
                    placeholder="What kind of gathering? e.g. Brunch, Movie night"
                    className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-cyan-500"
                  />
                )}
                {partyKind && (
                  <input
                    type="text"
                    value={partyTheme}
                    onChange={(e) => setPartyTheme(e.target.value)}
                    placeholder="Any theme or cuisine? e.g. Traditional Thanksgiving — or leave it to us"
                    className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-cyan-500"
                  />
                )}
                <div className="mb-2 flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={partyWhen}
                    onChange={(e) => setPartyWhen(e.target.value)}
                    placeholder="When? e.g. Fri Jun 20, 6pm"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-cyan-500"
                  />
                  <input
                    type="text"
                    value={partyWhere}
                    onChange={(e) => setPartyWhere(e.target.value)}
                    placeholder="Where? e.g. Room 12 / 5 Oak St"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1.5 text-slate-600">
                    Headcount
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={partyHeadcount}
                      onChange={(e) => setPartyHeadcount(e.target.value)}
                      placeholder="~"
                      className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-cyan-500"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-600">
                    <input
                      type="checkbox"
                      checked={partyDisposables}
                      onChange={(e) => setPartyDisposables(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
                    />
                    Using disposable plates/cups/cutlery
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-600">
                    <input
                      type="checkbox"
                      checked={partyRsvp}
                      onChange={(e) => setPartyRsvp(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
                    />
                    Ask who&apos;s coming (RSVP)
                  </label>
                </div>
                <p className="mt-2 text-[11px] text-cyan-700">
                  ✨ Once it&apos;s live, we&apos;ll suggest what&apos;s still needed as
                  people sign up.
                </p>
              </div>
            )}

            {/* Sign-up — claimable slots (label + capacity) */}
            {selectedType === "signup" && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Anything specific you want?{" "}
                  <span className="text-slate-400">(optional)</span>
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  No need to list everything — we&apos;ll suggest the rest as people sign
                  up. Just add any must-haves (e.g. Wings, Chips) and how many you need.
                </p>
                {signupSlots.map((s, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={s.label}
                      onChange={(e) => {
                        const next = [...signupSlots];
                        next[i] = { ...next[i], label: e.target.value };
                        setSignupSlots(next);
                      }}
                      placeholder={`e.g. ${
                        ["Drinks", "Cups & plates", "Cupcakes", "Music"][i] || "Item"
                      }`}
                      className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-orange-500 outline-none"
                    />
                    <div className="flex items-center gap-1">
                      {s.capacity === 0 ? (
                        <span
                          title="Any number can bring this"
                          className="w-12 rounded-xl border border-cyan-300 bg-cyan-50 py-2 text-center text-sm font-semibold text-cyan-700"
                        >
                          ∞
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={s.capacity}
                          onChange={(e) => {
                            const next = [...signupSlots];
                            next[i] = {
                              ...next[i],
                              capacity: parseInt(e.target.value || "1", 10),
                            };
                            setSignupSlots(next);
                          }}
                          title="How many people can bring this"
                          className="w-12 rounded-xl border border-slate-300 px-2 py-2 text-sm text-center focus:border-orange-500 outline-none"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...signupSlots];
                          next[i] = { ...next[i], capacity: s.capacity === 0 ? 1 : 0 };
                          setSignupSlots(next);
                        }}
                        title={
                          s.capacity === 0
                            ? "Set a specific number"
                            : "Any number can bring this"
                        }
                        className="rounded-lg px-1.5 py-1 text-sm font-bold text-slate-400 hover:text-cyan-600"
                      >
                        {s.capacity === 0 ? "#" : "∞"}
                      </button>
                    </div>
                    {signupSlots.length > 1 && (
                      <button
                        onClick={() =>
                          setSignupSlots(signupSlots.filter((_, j) => j !== i))
                        }
                        className="text-slate-400 hover:text-red-500 px-2"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {signupSlots.length < 30 && (
                  <button
                    onClick={() =>
                      setSignupSlots([...signupSlots, { label: "", capacity: 1 }])
                    }
                    className="text-sm text-orange-600 font-medium"
                  >
                    + Add slot
                  </button>
                )}
                <p className="mt-1 text-[11px] text-slate-400">
                  The number is how many people can bring it. Tap{" "}
                  <span className="font-semibold">∞</span> for things where any number
                  is welcome (e.g. drinks, snacks).
                </p>
              </div>
            )}

            {/* Truth or Dare — host writes both prompts; players pick blind */}
            {selectedType === "truth_or_dare" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Players commit to Truth or Dare <span className="font-semibold">before</span>{" "}
                  seeing the prompt — write a good one for each.
                </p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    🤐 Truth prompt
                  </label>
                  <textarea
                    value={truthPrompt}
                    onChange={(e) => setTruthPrompt(e.target.value)}
                    rows={2}
                    placeholder="e.g. What's the most embarrassing thing in your search history?"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-y"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    🔥 Dare prompt
                  </label>
                  <textarea
                    value={darePrompt}
                    onChange={(e) => setDarePrompt(e.target.value)}
                    rows={2}
                    placeholder="e.g. Post a selfie with the worst filter you can find."
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-y"
                  />
                </div>
              </div>
            )}

            {/* Care & Accountability — categories of interchangeable questions;
                one random pick per category locks in for the whole group each time */}
            {(selectedType === "care" || selectedType === "accountability") && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Question categories
                </label>
                <p className="mb-3 text-xs text-slate-500">
                  Give each category a few wordings. Every time this goes out,
                  Campfire randomly locks in <strong>“ask N of these”</strong> per
                  category for the <strong>whole group</strong> — so it never feels
                  the same month after month.
                </p>
                {careCategories.map((cat, ci) => {
                  const filled = cat.prompts.filter((p) => p.trim()).length;
                  const maxAsk = Math.max(1, filled || cat.prompts.length);
                  const updateCats = (
                    mut: (cats: typeof careCategories) => void
                  ) => {
                    const next = careCategories.map((c) => ({
                      ...c,
                      prompts: [...c.prompts],
                    }));
                    mut(next);
                    setCareCategories(next);
                  };
                  return (
                    <div
                      key={ci}
                      className="mb-3 rounded-xl border border-slate-200 p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-500">
                          Category {ci + 1}
                        </span>
                        {careCategories.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setCareCategories(
                                careCategories.filter((_, j) => j !== ci)
                              )
                            }
                            className="text-xs text-slate-400 hover:text-red-500"
                          >
                            Remove category
                          </button>
                        )}
                      </div>
                      {cat.prompts.map((p, pi) => (
                        <div key={pi} className="flex gap-2 mb-2 items-start">
                          <span className="text-slate-300 text-xs pt-2">
                            {pi + 1}.
                          </span>
                          <textarea
                            value={p}
                            onChange={(e) =>
                              updateCats((next) => {
                                next[ci].prompts[pi] = e.target.value;
                              })
                            }
                            rows={2}
                            placeholder={
                              selectedType === "accountability"
                                ? "Have you…? / How did you do with…?"
                                : "A wording — e.g. What has God been teaching you lately?"
                            }
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 outline-none resize-none"
                          />
                          {cat.prompts.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                updateCats((next) => {
                                  next[ci].prompts = next[ci].prompts.filter(
                                    (_, j) => j !== pi
                                  );
                                  const nf = next[ci].prompts.filter((x) =>
                                    x.trim()
                                  ).length;
                                  next[ci].ask = Math.min(
                                    next[ci].ask,
                                    Math.max(1, nf || next[ci].prompts.length)
                                  );
                                })
                              }
                              className="text-slate-400 hover:text-red-500 px-1 pt-1.5"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-1">
                        {cat.prompts.length < 8 && (
                          <button
                            type="button"
                            onClick={() =>
                              updateCats((next) => {
                                next[ci].prompts.push("");
                              })
                            }
                            className="text-xs text-orange-600 font-medium"
                          >
                            + Add wording
                          </button>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-500">Ask</span>
                          <select
                            value={Math.min(cat.ask, maxAsk)}
                            onChange={(e) =>
                              updateCats((next) => {
                                next[ci].ask = Number(e.target.value);
                              })
                            }
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-orange-500"
                          >
                            {Array.from({ length: maxAsk }, (_, n) => n + 1).map(
                              (n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              )
                            )}
                          </select>
                          <span className="text-xs text-slate-500">
                            of {maxAsk} each time
                          </span>
                        </div>
                        {selectedType === "care" && (
                          <div className="flex gap-1.5">
                            {(
                              [
                                { k: "text", label: "Text box" },
                                { k: "star", label: "⭐ 1–5" },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.k}
                                type="button"
                                onClick={() =>
                                  updateCats((next) => {
                                    next[ci].kind = opt.k;
                                  })
                                }
                                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                                  cat.kind === opt.k
                                    ? "border-teal-500 bg-teal-50 text-teal-700"
                                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {careCategories.length < 12 && (
                  <button
                    type="button"
                    onClick={() =>
                      setCareCategories([
                        ...careCategories,
                        { prompts: [""], kind: "text", ask: 1 },
                      ])
                    }
                    className="text-sm text-orange-600 font-medium"
                  >
                    + Add category
                  </button>
                )}
              </div>
            )}

            {/* Hall of Fame — tap award bubbles to build the survey + optional prize */}
            {selectedType === "hall_of_fame" && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Pick your awards — tap to add or remove
                </label>
                <p className="mb-2 text-xs text-slate-500">
                  Each award becomes a vote. Everyone picks a group-mate for each;
                  winners (and a graph) reveal together.
                </p>
                <div className="flex flex-wrap gap-2">
                  {Array.from(
                    new Set([...HALL_OF_FAME_SUGGESTIONS, ...questions.filter(Boolean)])
                  ).map((award) => {
                    const on = questions.includes(award);
                    return (
                      <button
                        key={award}
                        type="button"
                        onClick={() =>
                          setQuestions((prev) =>
                            prev.includes(award)
                              ? prev.filter((q) => q !== award)
                              : [...prev.filter(Boolean), award]
                          )
                        }
                        className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                          on
                            ? "border-fuchsia-500 bg-fuchsia-500 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-fuchsia-300"
                        }`}
                      >
                        {on ? "✓ " : "+ "}
                        {award}
                      </button>
                    );
                  })}
                </div>
                {/* Add a custom award */}
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={hofCustom}
                    onChange={(e) => setHofCustom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = hofCustom.trim();
                        if (v && !questions.includes(v))
                          setQuestions((prev) => [...prev.filter(Boolean), v]);
                        setHofCustom("");
                      }
                    }}
                    placeholder="Add your own award…"
                    className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-fuchsia-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const v = hofCustom.trim();
                      if (v && !questions.includes(v))
                        setQuestions((prev) => [...prev.filter(Boolean), v]);
                      setHofCustom("");
                    }}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Add
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {questions.filter(Boolean).length} award
                  {questions.filter(Boolean).length === 1 ? "" : "s"} selected.
                </p>

                {/* Optional: gift-card the winner of one award */}
                <div className="mt-4 rounded-xl border border-fuchsia-200 bg-fuchsia-50/50 p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={hofPrize}
                      onChange={(e) => setHofPrize(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-fuchsia-500 focus:ring-fuchsia-500"
                    />
                    🎁 Gift-card the winner of one award
                  </label>
                  {hofPrize ? (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-slate-600">Prize goes to the winner of</span>
                        <select
                          value={Math.min(
                            hofPrizeAward,
                            Math.max(0, questions.filter(Boolean).length - 1)
                          )}
                          onChange={(e) => setHofPrizeAward(parseInt(e.target.value, 10))}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-fuchsia-500"
                        >
                          {questions.filter(Boolean).map((q, i) => (
                            <option key={i} value={i}>
                              {q}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="text-xs text-slate-500">
                        The group chips in a pot; on reveal it&apos;s sent to that
                        award&apos;s winner as a gift card. (Set the amount options after
                        you create it, in the gift settings.)
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      Optional — make one award a real prize the group pitches in for.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Most Likely / Scavenger Hunt / Tournament — list of items */}
            {(selectedType === "most_likely" ||
              selectedType === "scavenger_hunt" ||
              selectedType === "tournament") && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {selectedType === "scavenger_hunt"
                    ? "The items to find (each answered with a photo or text)"
                    : selectedType === "tournament"
                    ? "The rounds / holes (each scored with a number)"
                    : "The awards (each one becomes a vote)"}
                </label>
                {questions.map((q, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-center">
                    <span className="text-slate-400 text-sm">
                      {selectedType === "scavenger_hunt" ||
                      selectedType === "tournament"
                        ? `${i + 1}.`
                        : "🏆"}
                    </span>
                    <input
                      type="text"
                      value={q}
                      onChange={(e) => {
                        const next = [...questions];
                        next[i] = e.target.value;
                        setQuestions(next);
                      }}
                      placeholder={
                        selectedType === "scavenger_hunt"
                          ? "Find / answer…"
                          : selectedType === "tournament"
                          ? "Hole 1 / Round 1 / Event…"
                          : "Most likely to…"
                      }
                      className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                    />
                    {questions.length > 1 && (
                      <button
                        onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                        className="text-slate-400 hover:text-red-500 px-2"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {questions.length < 30 && (
                  <button
                    onClick={() => setQuestions([...questions, ""])}
                    className="text-sm text-orange-600 font-medium"
                  >
                    {selectedType === "scavenger_hunt"
                      ? "+ Add item"
                      : selectedType === "tournament"
                      ? "+ Add round"
                      : "+ Add award"}
                  </button>
                )}
                {selectedType === "tournament" && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-green-200 bg-green-50/50 p-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600">Winner is the</label>
                      <select
                        value={tournDirection}
                        onChange={(e) =>
                          setTournDirection(e.target.value as "low" | "high")
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-green-500"
                      >
                        <option value="low">lowest total (golf)</option>
                        <option value="high">highest total (points)</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={tournScorecard}
                        onChange={(e) => setTournScorecard(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-green-500 focus:ring-green-500"
                      />
                      Require a scorecard photo
                    </label>
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {selectedType === "scavenger_hunt"
                    ? "Players answer each with a photo or a typed answer, in any order. Sealed until you reveal (use 🎬 Reveal now or a deadline)."
                    : selectedType === "tournament"
                    ? "Players enter a number for each round; the best total wins. Add a prize below — players don't have to be in the same place. Set a closing date to lock scores."
                    : "Everyone votes a group-mate for each award; winners are crowned at the reveal."}
                </p>
              </div>
            )}

            <button
              onClick={() => setStep("options")}
              disabled={!title.trim()}
              className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              Next: Set Options
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Options (reveal, blind, deadline) */}
      {step === "options" && selectedType && (
        <div>
          <button
            onClick={() => setStep("details")}
            className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block"
          >
            ← Back to details
          </button>

          <h2 className="text-lg font-bold text-slate-900 mb-4">Engagement Options</h2>

          <div className="space-y-5 max-w-lg">
            {/* Reveal Mode — hidden for types that are always sealed */}
            {selectedType !== "two_truths" &&
              selectedType !== "baby_reveal" &&
              selectedType !== "most_likely" &&
              selectedType !== "hall_of_fame" &&
              selectedType !== "accountability" &&
              selectedType !== "scavenger_hunt" &&
              selectedType !== "birthday" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Reveal Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "sealed" as const, label: "🔒 Sealed", desc: "Results hidden until everyone responds" },
                  { value: "all_at_once" as const, label: "🎬 All at Once", desc: "Creator triggers the reveal" },
                  { value: "as_they_come" as const, label: "📨 As They Come", desc: "See responses in real-time" },
                  { value: "instant" as const, label: "⚡ Instant", desc: "Results visible immediately" },
                ].map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setReveal(r.value)}
                    className={`rounded-xl border p-3 text-left transition ${
                      reveal === r.value
                        ? "border-orange-500 bg-orange-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="text-sm font-bold text-slate-900">{r.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{r.desc}</div>
                  </button>
                ))}
              </div>
              {reveal === "sealed" && (
                <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  🔒 This is the Campfire signature mechanic. Nobody sees results until the
                  last person responds — turning every engagement into a shared reveal event.
                </div>
              )}
            </div>
            )}

            {/* Blind mode — Two Truths adds a "guess who wrote it" layer when on */}
            {selectedType !== "baby_reveal" &&
              selectedType !== "most_likely" &&
              selectedType !== "hall_of_fame" &&
              selectedType !== "scavenger_hunt" &&
              selectedType !== "birthday" && (
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isBlind}
                    onChange={(e) => setIsBlind(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      🙈 {selectedType === "two_truths" ? "Anonymous (guess who too!)" : "Blind Responses"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {selectedType === "two_truths"
                        ? "Hide who wrote each set — players guess the lie AND who wrote it. Names reveal at the end."
                        : "Hide identities — no one knows whose response is whose"}
                    </div>
                  </div>
                </label>
              </div>
            )}

            {/* Deadline (hidden for a holiday card — its date is computed from the
                Nth-weekday pattern). Fixed-date cards (birthday/anniversary/one-time)
                show it. */}
            <div
              className={
                selectedType === "birthday" &&
                (occasion === "mothers_day" ||
                  occasion === "fathers_day" ||
                  occasion === "custom")
                  ? "hidden"
                  : ""
              }
            >
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {selectedType === "baby_reveal" ? (
                  <>
                    🍼 Reveal date <span className="text-rose-500">(required)</span>
                  </>
                ) : selectedType === "birthday" ? (
                  <>
                    {occasion === "anniversary"
                      ? "💍 Anniversary"
                      : occasion === "wedding"
                      ? "💒 Wedding day — reveals then"
                      : occasion === "once"
                      ? "🎉 Reveals on this day"
                      : "🎂 Birthday — reveals on this day"}{" "}
                    <span className="text-rose-500">(required)</span>
                  </>
                ) : (
                  <>
                    Deadline <span className="text-slate-400">(optional)</span>
                  </>
                )}
              </label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              />
              {selectedType === "baby_reveal" && (
                <p className="mt-1 text-xs text-slate-500">
                  Guesses stay sealed until this exact moment, then it auto-reveals with
                  the winners. Set the real answer on the engagement before then.
                </p>
              )}

              {/* Release in advance: open + email the group N days before the reveal */}
              {selectedType !== "birthday" &&
                selectedType !== "baby_reveal" &&
                recurrence === "none" &&
                !!deadline && (
                  <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50/50 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={releaseEarly}
                        onChange={(e) => setReleaseEarly(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                      />
                      📅 Open it ahead of the reveal
                    </label>
                    {releaseEarly ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-slate-600">Open &amp; email everyone</span>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={leadDays}
                          onChange={(e) =>
                            setLeadDays(parseInt(e.target.value || "14", 10))
                          }
                          className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-orange-500"
                        />
                        <span className="text-slate-600">
                          days before the{" "}
                          {new Date(deadline).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          reveal.
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">
                        Otherwise it stays a draft until you open it yourself. Tick this
                        and Campfire opens it + emails the group automatically, ahead of
                        the reveal date.
                      </p>
                    )}
                  </div>
                )}

              {/* Birthday extras: lead time + optional age */}
              {selectedType === "birthday" && (
                <div className="mt-2 space-y-2 rounded-xl border border-pink-200 bg-pink-50/50 p-3">
                  <p className="text-xs text-slate-600">
                    {occasion === "once" || occasion === "wedding" ? (
                      <>
                        A <span className="font-semibold">one-time</span> card — it
                        won&apos;t repeat.
                      </>
                    ) : (
                      <>
                        Runs <span className="font-semibold">every year</span>.
                      </>
                    )}{" "}
                    Pick the recipient under &ldquo;hide from…&rdquo; so it stays a
                    surprise.
                  </p>

                  {/* One-time: name the occasion (Retirement, Graduation, …) */}
                  {occasion === "once" && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-slate-600">Occasion</span>
                      <input
                        type="text"
                        value={onceLabel}
                        onChange={(e) => setOnceLabel(e.target.value)}
                        placeholder="Retirement, Graduation, Welcome…"
                        className="flex-1 min-w-[160px] rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-orange-500"
                      />
                    </div>
                  )}

                  {/* Holiday: show the floating date (preset summary or custom picker) */}
                  {occasion === "custom" && renderNthPicker()}
                  {(occasion === "mothers_day" || occasion === "fathers_day") && (
                    <p className="text-xs text-slate-600">
                      📅 <span className="font-semibold">{HOLIDAY_PRESETS[occasion].label}</span> —{" "}
                      {describeNthWeekday(HOLIDAY_PRESETS[occasion].nth)}. Next:{" "}
                      <span className="font-medium text-slate-700">
                        {nextNthWeekday(HOLIDAY_PRESETS[occasion].nth).toLocaleDateString(
                          undefined,
                          { weekday: "long", year: "numeric", month: "long", day: "numeric" }
                        )}
                      </span>
                      .
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-600">Open</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={leadDays}
                      onChange={(e) => setLeadDays(parseInt(e.target.value || "14", 10))}
                      className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-orange-500"
                    />
                    <span className="text-slate-600">days before, so people can sign.</span>
                  </div>

                  {/* An anchor year drives the {age} count. For a birthday that's the
                      age; for an anniversary/one-time it's a year count (e.g. years of
                      service from a start-of-employment year). Skip it for holidays. */}
                  {(occasion === "birthday" ||
                    occasion === "anniversary" ||
                    occasion === "once") && (
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-slate-600">
                          {occasion === "birthday" ? "Birth year" : "Start year"}
                        </span>
                        <input
                          type="number"
                          min={1900}
                          max={2100}
                          value={birthYear}
                          onChange={(e) => setBirthYear(e.target.value)}
                          placeholder="optional"
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-orange-500"
                        />
                        <span className="text-xs text-slate-500">
                          {occasion === "birthday" ? (
                            <>
                              — put <span className="font-mono">{"{age}"}</span> in the
                              title and it auto-fills the age (1st, 2nd, 28th…).
                            </>
                          ) : occasion === "anniversary" ? (
                            <>
                              — the year it began. Put{" "}
                              <span className="font-mono">{"{age}"}</span> in the title for
                              the # of years (10th, 25th…).
                            </>
                          ) : (
                            <>
                              — optional (e.g. start of employment). Put{" "}
                              <span className="font-mono">{"{age}"}</span> in the title for
                              the # of years.
                            </>
                          )}
                        </span>
                      </div>
                      {title.includes("{age}") && (
                        <div className="rounded-lg bg-white border border-pink-200 px-3 py-1.5 text-sm">
                          <span className="text-xs text-slate-400">Shows as: </span>
                          <span className="font-semibold text-slate-800">
                            {deadline
                              ? resolveTitle(
                                  title,
                                  birthYear.trim() ? parseInt(birthYear, 10) : null,
                                  new Date(deadline).toISOString()
                                )
                              : "set the birthday date to preview"}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Hold the reveal until the deadline — only for sealed mode (baby
                  reveal already always holds, so don't show the toggle there) */}
              {reveal === "sealed" &&
                selectedType !== "baby_reveal" &&
                selectedType !== "birthday" && (
                <label
                  className={`mt-2 flex items-start gap-3 rounded-xl border p-3 ${
                    deadline
                      ? "border-slate-200 bg-white cursor-pointer"
                      : "border-slate-100 bg-slate-50 opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={holdUntilDeadline}
                    disabled={!deadline}
                    onChange={(e) => {
                      setHoldUntilDeadline(e.target.checked);
                      if (e.target.checked) setWaitForAllInvited(false);
                    }}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      ⏳ Reveal on the date — no matter who&apos;s responded (surprise mode)
                    </div>
                    <div className="text-xs text-slate-500">
                      {deadline
                        ? "Opens at the deadline regardless — like a birthday gift on the day. Off = reveals as soon as everyone who's in has responded (or at the deadline, whichever comes first)."
                        : "Set a deadline above to enable this."}
                    </div>
                  </div>
                </label>
              )}

              {/* Wait for the whole invite list — only when NOT revealing on the date */}
              {(reveal === "sealed" || selectedType === "two_truths") &&
                selectedType !== "baby_reveal" &&
                selectedType !== "birthday" && (
                <label
                  className={`mt-2 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 ${
                    holdUntilDeadline ? "opacity-50" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={waitForAllInvited && !holdUntilDeadline}
                    disabled={holdUntilDeadline}
                    onChange={(e) => {
                      waitTouched.current = true;
                      setWaitForAllInvited(e.target.checked);
                    }}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      ✉️ Wait until everyone invited has joined &amp; responded
                    </div>
                    <div className="text-xs text-slate-500">
                      {holdUntilDeadline
                        ? "Not used — the date option above opens it regardless. Uncheck that to use this."
                        : (
                          <>
                            {waitForAllInvited && !waitTouched.current && pendingForTarget > 0 && (
                              <span className="text-amber-700">
                                On by default — {pendingForTarget} invited{" "}
                                {pendingForTarget === 1 ? "person hasn't" : "people haven't"}{" "}
                                joined yet.{" "}
                              </span>
                            )}
                            Don&apos;t reveal just because the joined members answered —
                            hold it until invited people join and respond too.{" "}
                            {deadline
                              ? "The deadline still acts as a backstop."
                              : "⚠️ Add a deadline as a backstop so it can't freeze if someone never joins."}
                          </>
                        )}
                    </div>
                  </div>
                </label>
              )}
            </div>

            {/* Repeat (birthday is always yearly, so hide it there) */}
            {selectedType !== "birthday" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Repeat <span className="text-slate-400">(optional)</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { value: "none" as const, label: "Once" },
                  { value: "daily" as const, label: "🔁 Daily" },
                  { value: "weekly" as const, label: "🔁 Weekly" },
                  { value: "monthly" as const, label: "🔁 Monthly" },
                  { value: "monthly_nth" as const, label: "🗓️ Monthly (e.g. 2nd Sun at 4pm)" },
                  { value: "yearly_nth" as const, label: "🗓️ Yearly (a date like 2nd Sun May)" },
                ].map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRecurrence(r.value)}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                      r.value === "yearly_nth" || r.value === "monthly_nth"
                        ? "col-span-2 sm:col-span-3"
                        : ""
                    } ${
                      recurrence === r.value
                        ? "border-orange-500 bg-orange-50 text-slate-900"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              {recurrence === "yearly_nth" ? (
                <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
                  {renderNthPicker()}
                </div>
              ) : recurrence === "monthly_nth" ? (
                <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
                  {renderMonthlyNthPicker()}
                </div>
              ) : (
                recurrence !== "none" && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    A fresh copy auto-posts to the group every{" "}
                    {recurrence === "daily" ? "day" : recurrence === "weekly" ? "week" : "month"}{" "}
                    after this one wraps.
                  </p>
                )
              )}
            </div>
            )}

            {/* Surprise: hide from selected members / invitees until the reveal */}
            {(groupMembers.length > 0 || pendingInvitees.length > 0) && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-sm font-medium text-slate-700">
                  🎁 Surprise — hide from… <span className="text-slate-400">(optional)</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  Anyone you pick won&apos;t see it (or get emailed) until the reveal —
                  then everyone gets it, including them. Great for a birthday card.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {groupMembers.map((m) => {
                    const on = excludedIds.includes(m.user_id);
                    return (
                      <button
                        key={m.user_id}
                        type="button"
                        onClick={() =>
                          setExcludedIds((prev) =>
                            on ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id]
                          )
                        }
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          on
                            ? "border-rose-500 bg-rose-500 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-rose-300"
                        }`}
                      >
                        {on ? "🙈 " : ""}
                        {m.name}
                      </button>
                    );
                  })}
                  {pendingInvitees.map((p) => {
                    const on = excludedEmails.includes(p.email);
                    return (
                      <button
                        key={p.email}
                        type="button"
                        title="Invited but not joined yet — they'll stay hidden when they join."
                        onClick={() =>
                          setExcludedEmails((prev) =>
                            on ? prev.filter((e) => e !== p.email) : [...prev, p.email]
                          )
                        }
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          on
                            ? "border-rose-500 bg-rose-500 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-600 hover:border-rose-300"
                        }`}
                      >
                        {on ? "🙈 " : ""}
                        {p.name || p.email}{" "}
                        <span className={on ? "text-rose-100" : "text-slate-400"}>· not joined</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cover images — a pool; Campfire shows a random one */}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-sm font-medium text-slate-700">
                🖼️ Cover image(s) <span className="text-slate-400">(optional)</span>
              </div>
              <p className="text-xs text-slate-500 mb-2">
                A banner at the top. Add as many as you like — Campfire shows a{" "}
                <span className="font-semibold">random one</span> (a fresh pick each year
                for a birthday).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  {coverUploading ? "Uploading…" : "📷 Upload image(s)"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (!files.length || !user) return;
                      setCoverUploading(true);
                      for (const file of files) {
                        const ext = file.name.split(".").pop();
                        const path = `${user.id}/covers/${Date.now()}-${Math.random()
                          .toString(36)
                          .slice(2, 7)}.${ext}`;
                        const { error: upErr } = await supabase.storage
                          .from("campfire-media")
                          .upload(path, file);
                        if (upErr) {
                          alert("Upload failed: " + upErr.message);
                          continue;
                        }
                        const { data } = supabase.storage.from("campfire-media").getPublicUrl(path);
                        setCoverUrls((prev) => [...prev, data.publicUrl]);
                      }
                      setCoverUploading(false);
                    }}
                  />
                </label>
                <input
                  type="url"
                  value={coverPaste}
                  onChange={(e) => setCoverPaste(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && coverPaste.trim()) {
                      e.preventDefault();
                      setCoverUrls((prev) => [...prev, coverPaste.trim()]);
                      setCoverPaste("");
                    }
                  }}
                  placeholder="…or paste an image URL + Enter"
                  className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-orange-500 outline-none"
                />
              </div>
              {coverUrls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {coverUrls.map((u, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u}
                        alt=""
                        className="h-20 w-28 rounded-lg object-cover border border-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() => setCoverUrls((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 rounded-full bg-white border border-slate-300 w-5 h-5 text-xs text-slate-500 hover:text-red-600 shadow"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {coverUrls.length > 1 && (
                <p className="mt-1 text-[11px] text-slate-400">
                  {coverUrls.length} images — one is shown at random.
                </p>
              )}
            </div>

            {/* Launch notifies the group — no toggle, so nobody gets left out. */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600">
              📧 This stays a private draft until you hit Launch. The moment you
              launch, everyone in the group{" "}
              {excludedIds.length > 0 ? "(except your surprise picks) " : ""}
              gets an email to respond — and again when the results reveal.
            </div>

            {/* Let members invite others to this engagement */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowMemberInvites}
                onChange={(e) => setAllowMemberInvites(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
              />
              <div>
                <div className="text-sm font-medium text-slate-700">
                  👥 Let members invite others to this
                </div>
                <div className="text-xs text-slate-500">
                  Anyone in the group (not just you) can invite people to this
                  engagement. Off = only you can.
                </div>
              </div>
            </label>

            {/* Keep responses private to the host */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={privateToHost}
                onChange={(e) => setPrivateToHost(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
              />
              <div>
                <div className="text-sm font-medium text-slate-700">
                  🔒 Keep responses private to me (the host)
                </div>
                <div className="text-xs text-slate-500">
                  Only you see each person&apos;s response — never the rest of the
                  group, even after the reveal. Good for sensitive sharing. Off = the
                  group sees responses at the reveal.
                </div>
              </div>
            </label>

            {/* Prize pot — goes to the winner (photo Challenge / Scavenger Hunt / Tournament) */}
            {(selectedType === "challenge" ||
              selectedType === "scavenger_hunt" ||
              selectedType === "tournament") && (
              <div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={raffleOn}
                    onChange={(e) => setRaffleOn(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      🏆 Make it a prize{" "}
                      {selectedType === "scavenger_hunt"
                        ? "hunt"
                        : selectedType === "tournament"
                        ? "tournament"
                        : "challenge"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {selectedType === "tournament"
                        ? "People fund a pot (optional chip-ins or an entry fee). When scores lock at the closing date, the best total wins the gift card."
                        : "People chip in toward a pot until the closing date. After entries close, the group votes — one vote each — and the winner gets the gift card."}
                    </div>
                  </div>
                </label>
                {raffleOn && (
                  <div className="mt-2 ml-7 space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                    <div className="flex items-center gap-2">
                      <label className="w-36 text-xs text-slate-600">Your cut (host)</label>
                      <select
                        value={raffleSplit}
                        onChange={(e) => setRaffleSplit(Number(e.target.value))}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-amber-500"
                      >
                        <option value={0}>Winner takes all</option>
                        <option value={10}>90% winner / 10% you</option>
                        <option value={25}>75% / 25%</option>
                        <option value={50}>50 / 50</option>
                      </select>
                    </div>
                    {selectedType !== "tournament" && (
                      <div className="flex items-center gap-2">
                        <label className="w-36 text-xs text-slate-600">Voting window</label>
                        <select
                          value={raffleVoteDays}
                          onChange={(e) => setRaffleVoteDays(Number(e.target.value))}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-amber-500"
                        >
                          <option value={2}>2 days</option>
                          <option value={3}>3 days</option>
                          <option value={5}>5 days</option>
                          <option value={7}>7 days</option>
                        </select>
                        <span className="text-[11px] text-slate-400">after entries close</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <label className="w-36 text-xs text-slate-600">Hold reveal until</label>
                      <select
                        value={raffleGate}
                        onChange={(e) => setRaffleGate(Number(e.target.value))}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-amber-500"
                      >
                        <option value={0}>Off — reveal on the date</option>
                        <option value={80}>80% have entered</option>
                        <option value={90}>90% have entered</option>
                        <option value={100}>everyone has entered</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="w-36 text-xs text-slate-600">Funding</label>
                      <select
                        value={raffleEntryFee > 0 ? "paid" : "chipin"}
                        onChange={(e) =>
                          setRaffleEntryFee(e.target.value === "paid" ? 1000 : 0)
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-amber-500"
                      >
                        <option value="chipin">Free entry + optional chip-ins</option>
                        <option value="paid">Paid entry (set fee →)</option>
                      </select>
                      {raffleEntryFee > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-slate-500">
                            {giftCurrency.toUpperCase()} $
                          </span>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={(raffleEntryFee / 100).toString()}
                            onChange={(e) =>
                              setRaffleEntryFee(
                                Math.max(0, Math.round(parseFloat(e.target.value) * 100) || 0)
                              )
                            }
                            className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-amber-500"
                          />
                          <span className="text-[11px] text-slate-400">to enter</span>
                        </div>
                      )}
                    </div>
                    {raffleEntryFee > 0 && (
                      <p className="text-[11px] text-amber-700">
                        Players pay {giftCurrency.toUpperCase()} $
                        {(raffleEntryFee / 100).toFixed(2)} to submit an entry — it funds
                        the pot and isn&apos;t refundable.
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <label className="w-36 text-xs text-slate-600">Pot currency</label>
                      <select
                        value={giftCurrency}
                        onChange={(e) => setGiftCurrency(e.target.value)}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-amber-500"
                      >
                        {GIFT_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Set a closing date below — entries end and voting begins there
                      {raffleGate > 0
                        ? ". The date is the hard backstop if the participation goal isn't met first."
                        : "."}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Pledge Drive — goal, per-unit rate, and who receives the funds */}
            {selectedType === "pledge_drive" && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 space-y-3">
                <div className="text-sm font-bold text-rose-800">🎗️ Pledge details</div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-slate-600">Goal: read / do</label>
                  <input
                    type="number"
                    min={1}
                    value={pledgeGoal}
                    onChange={(e) => setPledgeGoal(e.target.value)}
                    placeholder="100"
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-rose-500"
                  />
                  <input
                    type="text"
                    value={pledgeUnit}
                    onChange={(e) => setPledgeUnit(e.target.value)}
                    placeholder="pages"
                    className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-rose-500"
                  />
                  <span className="text-[11px] text-slate-400">(e.g. 100 pages, 10 km)</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-slate-600">Suggested pledge</label>
                  <span className="text-xs text-slate-500">{giftCurrency.toUpperCase()} $</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={pledgeRate}
                    onChange={(e) => setPledgeRate(e.target.value)}
                    placeholder="0.10"
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-rose-500"
                  />
                  <span className="text-[11px] text-slate-400">
                    per {pledgeUnit || "unit"} (optional — sponsors can set their own)
                  </span>
                </div>
                <input
                  type="email"
                  value={giftRecipientEmail}
                  onChange={(e) => setGiftRecipientEmail(e.target.value)}
                  placeholder="Who receives the funds — the participant's email"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-500"
                />
                <input
                  type="text"
                  value={giftRecipientName}
                  onChange={(e) => setGiftRecipientName(e.target.value)}
                  placeholder="Participant's name (e.g. Mila)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-500"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600">Currency</label>
                  <select
                    value={giftCurrency}
                    onChange={(e) => setGiftCurrency(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-rose-500"
                  >
                    {GIFT_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-slate-400">
                  Sponsors pledge a lump sum or a per-{pledgeUnit || "unit"} rate (with a
                  cap). They&apos;re charged the estimate upfront and auto-refunded the
                  shortfall once you post the result on the date. Set a date below.
                </p>
              </div>
            )}

            {/* Raffle Draw — odds + host cut (the pot is funded by chip-ins) */}
            {selectedType === "raffle_draw" && (
              <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/50 p-4 space-y-3">
                <div className="text-sm font-bold text-fuchsia-800">🎟️ Raffle settings</div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-slate-600">Odds</label>
                  <select
                    value={drawWeighted ? "weighted" : "flat"}
                    onChange={(e) => setDrawWeighted(e.target.value === "weighted")}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-fuchsia-500"
                  >
                    <option value="weighted">More chips = better odds</option>
                    <option value="flat">One entry each (equal odds)</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-slate-600">Winner&apos;s cut</label>
                  <select
                    value={raffleSplit}
                    onChange={(e) => setRaffleSplit(Number(e.target.value))}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-fuchsia-500"
                  >
                    <option value={0}>Winner takes all</option>
                    <option value={50}>50 / 50 (half to you/a cause)</option>
                    <option value={25}>75% winner / 25% you</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-slate-600">The draw</label>
                  <select
                    value={drawAuto ? "auto" : "manual"}
                    onChange={(e) => setDrawAuto(e.target.value === "auto")}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-fuchsia-500"
                  >
                    <option value="auto">Automatically at the closing date</option>
                    <option value="manual">I&apos;ll draw it live at the event</option>
                  </select>
                </div>
                <p className="text-[11px] text-fuchsia-700">
                  🔒 Either way the pick is 100% random — Campfire draws it, weighting by
                  how much each person chipped in (if you chose that). No one, not even
                  you, can influence who wins.
                </p>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600">Pot currency</label>
                  <select
                    value={giftCurrency}
                    onChange={(e) => setGiftCurrency(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-fuchsia-500"
                  >
                    {GIFT_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-slate-400">
                  Everyone chips in to the pot. At the closing date (or when you draw at
                  the event), a random winner is picked and paid the pot.
                </p>
              </div>
            )}

            {/* Baby Reveal — who reveals the name + gender (the person having the baby) */}
            {selectedType === "baby_reveal" && (
              <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
                <label className="block text-sm font-bold text-sky-800 mb-1">
                  🍼 Who&apos;s having the baby? (they reveal the name &amp; gender)
                </label>
                <select
                  value={babyRevealerId}
                  onChange={(e) => setBabyRevealerId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                >
                  <option value="">Me — I&apos;ll do the reveal</option>
                  {groupMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Guests propose a boy name + a girl name and guess the gender. The person
                  above privately sets the real name &amp; gender, revealed on the big day.
                  Just for fun anticipating the arrival — it doesn&apos;t replace your own
                  special reveal. 💙
                </p>
              </div>
            )}

            {/* Optional declared cause (thons + raffles) */}
            {(selectedType === "pledge_drive" ||
              selectedType === "raffle_draw" ||
              ((selectedType === "challenge" ||
                selectedType === "scavenger_hunt" ||
                selectedType === "tournament") &&
                raffleOn)) && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <label className="block text-sm font-bold text-emerald-800 mb-1">
                  💛 For a cause? (optional)
                </label>
                <input
                  type="text"
                  value={causeInput}
                  onChange={(e) => setCauseInput(e.target.value)}
                  placeholder="e.g. proceeds to the local food bank"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Shown to everyone who contributes. Campfire pays the funds to the
                  host/recipient — <b>you&apos;re responsible for passing them on to the
                  cause</b>. (Campfire isn&apos;t a charity and doesn&apos;t issue tax
                  receipts.)
                </p>
              </div>
            )}

            {/* Group gift — chip in toward a gift card for the recipient */}
            {!(
              ((selectedType === "challenge" ||
                selectedType === "scavenger_hunt" ||
                selectedType === "tournament") &&
                raffleOn) ||
              selectedType === "pledge_drive" ||
              selectedType === "raffle_draw"
            ) && (
            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={giftEnabled}
                  onChange={(e) => setGiftEnabled(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                />
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    🎁 Collect a group gift
                  </div>
                  <div className="text-xs text-slate-500">
                    People can chip in when they sign. On reveal, a gift card for the
                    total is emailed to the recipient.
                  </div>
                </div>
              </label>
              {giftEnabled && (
                <div className="mt-2 ml-7 space-y-2 rounded-xl border border-orange-200 bg-orange-50/50 p-3">
                  <input
                    type="email"
                    value={giftRecipientEmail}
                    onChange={(e) => setGiftRecipientEmail(e.target.value)}
                    placeholder="Recipient's email (where the gift card is sent)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                  />
                  <input
                    type="text"
                    value={giftRecipientName}
                    onChange={(e) => setGiftRecipientName(e.target.value)}
                    placeholder="Recipient's name (optional)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-600">Currency</label>
                    <select
                      value={giftCurrency}
                      onChange={(e) => setGiftCurrency(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-orange-500"
                    >
                      {GIFT_CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-slate-400">
                      e.g. {formatMoney(500, giftCurrency)} /{" "}
                      {formatMoney(1000, giftCurrency)} /{" "}
                      {formatMoney(2000, giftCurrency)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Contributions are charged when someone chips in, and refunded if the
                    card is canceled before reveal.
                  </p>
                </div>
              )}
            </div>
            )}

            {/* Let members reply anonymously after release */}
            {!privateToHost && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowAnonReplies}
                  onChange={(e) => setAllowAnonReplies(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                />
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    🕊️ Let members reply anonymously
                  </div>
                  <div className="text-xs text-slate-500">
                    After it&apos;s released, members can leave each other a reply
                    without their name attached. Good for honest encouragement.
                  </div>
                </div>
              </label>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={creating}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-3 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "✏️ Create draft — review & launch next"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
