// frontend/src/app/teebee/blog/png-swt-fortnightly-tables-2026/page.tsx
"use client";

import React from "react";
import { BlogPost } from "../_shell";

export default function Post() {
  return (
    <BlogPost
      title="PNG Salary & Wages Tax: The Fortnightly Tables, Explained"
      lead="Where the K20,000 tax-free threshold actually comes from, how to read Tables A, B and C, and the math behind every fortnightly deduction."
      dateLabel="May 2026" readMin={7}
    >
      <p>
        If you've ever stared at a PNG IRC fortnightly tax table and wondered why your
        employee's K1,400 paycheck has the deduction it does, this post is for you.
        It is the math we run for every TeebeePay payroll, explained in plain English.
      </p>

      <h2>The annual brackets behind every fortnightly number</h2>
      <p>
        Papua New Guinea's resident Salary or Wages Tax (SWT) is progressive — meaning
        each band of your income is taxed at its own rate. Since January 2023 the
        bands have been unchanged. Here they are in annual terms:
      </p>
      <table>
        <thead><tr><th>Annual taxable income (PGK)</th><th>Marginal rate</th><th>Cumulative tax at top of band</th></tr></thead>
        <tbody>
          <tr><td>0 – 20,000</td><td>0%</td><td>K 0</td></tr>
          <tr><td>20,001 – 33,000</td><td>30%</td><td>K 3,900</td></tr>
          <tr><td>33,001 – 70,000</td><td>35%</td><td>K 16,850</td></tr>
          <tr><td>70,001 – 250,000</td><td>40%</td><td>K 88,850</td></tr>
          <tr><td>250,001 and above</td><td>42%</td><td>+42% on excess</td></tr>
        </tbody>
      </table>
      <p>
        The IRC publishes those annual figures as <strong>fortnightly tables</strong>
        because most PNG SMEs pay fortnightly. To convert, divide every threshold by 26
        (there are 26 fortnights in a year).
      </p>
      <table>
        <thead><tr><th>Fortnightly taxable income (PGK)</th><th>Marginal rate</th></tr></thead>
        <tbody>
          <tr><td>0 – 769.23</td><td>0%</td></tr>
          <tr><td>769.24 – 1,269.23</td><td>30%</td></tr>
          <tr><td>1,269.24 – 2,692.31</td><td>35%</td></tr>
          <tr><td>2,692.32 – 9,615.38</td><td>40%</td></tr>
          <tr><td>9,615.39+</td><td>42%</td></tr>
        </tbody>
      </table>

      <h2>Tables A, B and C — what they're for</h2>
      <p>
        The IRC publishes three tables, not one. The difference is who they apply to:
      </p>
      <ul>
        <li><strong>Table A</strong> — residents who have lodged a tax declaration with their employer. This is the everyday case.</li>
        <li><strong>Table B</strong> — residents who have <em>not</em> lodged a declaration. There is no tax-free threshold; tax begins on the first kina earned.</li>
        <li><strong>Table C</strong> — non-residents (anyone in PNG for fewer than 183 days in a 12-month period). Also no tax-free threshold; 22% from the first kina.</li>
      </ul>
      <p>
        If your employee fills in Form S1 ("Declaration") when they're hired and you keep
        it on file, you use Table A. If they don't, you must withhold at Table B (which
        will hit them harder), and the IRC will assume they have a second undeclared job.
      </p>

      <h2>A worked example: Employee on K2,500 per fortnight</h2>
      <p>
        Say one of your employees earns K2,500 per fortnight. Resident, declaration lodged,
        two dependants. We compute their SWT in three steps.
      </p>
      <h3>Step 1 — Find the gross taxable income</h3>
      <p>
        Gross is K2,500. Subtract the 6% Nasfund employee contribution first because
        Nasfund is pre-tax in PNG: K2,500 − K150 = <strong>K2,350 taxable</strong>.
      </p>
      <h3>Step 2 — Apply the brackets progressively</h3>
      <ul>
        <li>0 – K769.23 at 0% → K0</li>
        <li>K769.24 – K1,269.23 (i.e. K500) at 30% → K150</li>
        <li>K1,269.24 – K2,350 (i.e. K1,080.76) at 35% → K378.27</li>
      </ul>
      <p>Total gross tax: <strong>K528.27</strong></p>
      <h3>Step 3 — Subtract the dependant rebate</h3>
      <p>
        For two dependants, the IRC formula is Max(K75, Min(25% × annual_tax, K750)) per year.
        Two dependants on this annual tax bill claims roughly the K750 ceiling, which works
        out to <strong>K28.85 per fortnight</strong>.
      </p>
      <p>
        Net SWT payable: K528.27 − K28.85 = <strong>K499.42 per fortnight.</strong>
      </p>

      <h2>Two common mistakes we see</h2>
      <ol>
        <li>
          <strong>Forgetting that Nasfund comes off first.</strong> A surprising number of
          PNG payrolls run tax on the raw gross. That over-withholds employees by a few
          per cent — and adds up to thousands of kina a year for higher earners.
        </li>
        <li>
          <strong>Using Table A when a declaration hasn't been lodged.</strong> If an IRC
          audit finds undeclared employees on Table A, the employer is liable for the
          difference plus penalty. Always keep Form S1 on file.
        </li>
      </ol>

      <h2>The K17,500 → K20,000 threshold change</h2>
      <p>
        Until December 2022 the tax-free threshold was K17,500 a year. The 2023 PNG Budget
        raised it to <strong>K20,000</strong> and removed the old 22% bracket for residents.
        Anyone running PNG payroll on a pre-2023 reference is over-taxing employees in the
        K17,500 – K20,000 band. Worth double-checking.
      </p>

      <h2>How TeebeePay handles all this for you</h2>
      <p>
        TeebeePay has the SWT brackets, the Nasfund 6%/8.4% split, the dependant-rebate
        formula and the residency/declaration logic coded in. You enter hours and notes;
        we produce the pay stub, the BSP batch CSV, the NASFund return and the IRC
        summary. When the IRC changes a bracket, we update it once and every PNG employer
        using TeebeePay gets the new tables automatically. No spreadsheet to maintain,
        no late-night recalculation when the budget reshuffles things.
      </p>
    </BlogPost>
  );
}
