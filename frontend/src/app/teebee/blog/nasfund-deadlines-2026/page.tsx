// frontend/src/app/teebee/blog/nasfund-deadlines-2026/page.tsx
"use client";

import React from "react";
import { BlogPost } from "../_shell";

export default function Post() {
  return (
    <BlogPost
      title="NASFund Deadlines 2026: Every Employer's Cheat Sheet"
      lead="The 21st-of-the-month rule, what you owe if you miss it, the contribution split, and how to file NCSL the painless way."
      dateLabel="May 2026" readMin={5}
    >
      <p>
        If you employ anyone in Papua New Guinea who earns K1,250 or more a month,
        you are statutorily required to contribute to a superannuation fund — most
        commonly Nasfund. The mechanics are simple. The penalties for missing the
        deadline aren't. Here's the cheat sheet every SME owner should keep close.
      </p>

      <h2>The contribution split</h2>
      <ul>
        <li><strong>Employee:</strong> 6% of gross pay (the legal minimum). Deducted from each pay run.</li>
        <li><strong>Employer:</strong> 8.4% of gross pay. Paid <em>in addition</em> to wages, not from them.</li>
        <li><strong>Total to Nasfund per employee:</strong> 14.4% of their gross.</li>
      </ul>
      <p>
        Employees can opt to contribute more (Voluntary Member Contribution).
        The 8.4% employer rate is fixed and cannot be reduced.
      </p>

      <h2>The 21st-of-the-month rule</h2>
      <p>
        Nasfund contributions for any given month are due by the <strong>21st of the
        following month</strong>. So:
      </p>
      <table>
        <thead><tr><th>Contribution month</th><th>Due date</th></tr></thead>
        <tbody>
          <tr><td>January 2026</td><td>21 February 2026</td></tr>
          <tr><td>February 2026</td><td>21 March 2026</td></tr>
          <tr><td>March 2026</td><td>21 April 2026</td></tr>
          <tr><td>April 2026</td><td>21 May 2026</td></tr>
          <tr><td>May 2026</td><td>21 June 2026</td></tr>
          <tr><td>June 2026</td><td>21 July 2026</td></tr>
          <tr><td>July 2026</td><td>21 August 2026</td></tr>
          <tr><td>August 2026</td><td>21 September 2026</td></tr>
          <tr><td>September 2026</td><td>21 October 2026</td></tr>
          <tr><td>October 2026</td><td>21 November 2026</td></tr>
          <tr><td>November 2026</td><td>21 December 2026</td></tr>
          <tr><td>December 2026</td><td>21 January 2027</td></tr>
        </tbody>
      </table>

      <h2>What if you miss it?</h2>
      <p>
        Late contributions attract a penalty of <strong>2% of the unpaid balance per
        month</strong>. That sounds small but compounds quickly. K20,000 of unremitted
        contributions for six months means K2,400+ in penalty interest on top of the
        original liability.
      </p>
      <p>
        Beyond the penalty, Nasfund can recover unpaid contributions as a civil debt
        through the courts. The director of a company can be held personally liable for
        unremitted employee contributions — this is one of the few areas of PNG law
        where the corporate veil offers no protection.
      </p>

      <h2>The actual filing — what Nasfund needs from you</h2>
      <p>
        Each month you file a <strong>contribution return</strong> alongside the payment.
        The return must list every member who contributed in that month, with:
      </p>
      <ul>
        <li>NASFund member number</li>
        <li>Surname and given names</li>
        <li>Date of birth (yes — this is why TeebeePay asks for it on employee setup)</li>
        <li>Gross pay for the month</li>
        <li>Employee 6% contribution</li>
        <li>Employer 8.4% contribution</li>
        <li>Total per employee</li>
      </ul>
      <p>
        Nasfund accepts the return in their standard XLSX template, which is what
        TeebeePay produces automatically each month for our clients.
      </p>

      <h2>The 'NCSL' moniker — what it is</h2>
      <p>
        You'll see Nasfund returns sometimes labelled "NCSL". That's the legacy name —
        the National Contribution to Superannuation Levy. Nasfund renamed but many
        bookkeepers and templates still use NCSL. Both refer to the same statutory
        contribution.
      </p>

      <h2>One trap to know about</h2>
      <p>
        Allowances (housing, vehicle, meals, etc.) <strong>are part of gross</strong> for
        Nasfund purposes if they're paid in cash. A taxable benefit-in-kind (e.g. the
        employer providing a company-owned vehicle) is added to gross for SWT but is
        generally <em>not</em> part of the Nasfund contribution base — there's no cash
        value flowing through the payroll. Getting this distinction wrong is one of
        the most common audit findings.
      </p>

      <h2>How TeebeePay handles it</h2>
      <p>
        TeebeePay tracks every contribution every fortnight and at month-end generates
        the Nasfund return XLSX plus the payment summary, ready to upload. We send you a
        reminder five business days before the 21st of every month so the deadline
        never sneaks up.
      </p>
      <p>
        If you're managing Nasfund returns by hand right now, you're spending two to
        three hours a month on a process that can be reduced to two minutes. It's also
        the single most common place we see SMEs get penalty notices — almost always
        because the spreadsheet got moved, or the bookkeeper forgot, or the year-end
        rollover wasn't done. Worth handing off.
      </p>
    </BlogPost>
  );
}
