// frontend/src/app/teebee/blog/onboarding-new-employee-png/page.tsx
"use client";

import React from "react";
import { BlogPost } from "../_shell";

export default function Post() {
  return (
    <BlogPost
      title="Onboarding a New Employee in PNG: A Step-by-Step Guide"
      lead="From the IRC declaration to NASFund membership to first pay stub — everything an SME owner needs to do, in order, the first time someone joins the payroll."
      dateLabel="May 2026" readMin={6}
    >
      <p>
        Hiring your first employee in Papua New Guinea — or your fiftieth — involves
        more compliance steps than most SME owners realise. Skipping any of them
        creates problems later: missed Nasfund contributions, IRC withholding errors,
        and the most painful one of all, a surprise audit finding at year-end. Here
        is the full sequence we walk new TBA clients through.
      </p>

      <h2>Before they start</h2>

      <h3>1. Make sure they have a NASFund member number</h3>
      <p>
        Every PNG worker should have a unique NASFund member number. If your new hire
        already has one (most workers who've had a previous job do), get it from them
        on day one. If they don't, you need to register them. Nasfund's online portal
        accepts new-member registrations and issues a number within a few days.
      </p>

      <h3>2. Have them complete Form S1 (Salary or Wages Tax Declaration)</h3>
      <p>
        This is the IRC declaration form that tells you whether to apply Table A
        (resident, declared) or Table B (resident, undeclared) when withholding tax.
        Form S1 also captures whether they're claiming dependants — which affects
        their fortnightly tax via the dependant rebate.
      </p>
      <p>
        Keep the signed original on file. The IRC can demand to see it during an
        audit and "the employee said they had two dependants" without paperwork
        won't save you from a back-tax assessment.
      </p>

      <h3>3. Collect banking details</h3>
      <p>
        For most PNG employers this means a BSP, Kina, Westpac or ANZ account number
        plus the branch code. TeebeePay also supports splitting one employee's pay
        across multiple accounts (e.g. K500 to a savings account and the rest to the
        main account) by percentage — handy for employees who want to enforce their
        own savings discipline.
      </p>

      <h2>Setting them up in payroll</h2>

      <h3>4. Decide salary vs hourly</h3>
      <p>
        Salaried employees are paid the same amount every fortnight regardless of
        hours, with the annual figure divided by 26. Hourly employees are paid for
        actual hours worked, with overtime kicking in above 80 hours per fortnight
        at 1.5× the base rate (the legal minimum overtime multiplier in PNG).
      </p>

      <h3>5. Set the default hours per period</h3>
      <p>
        Full-time PNG employees normally have an "assigned full-time hours per
        fortnight" of 80. Part-timers might be 40 or 60. This default is what
        TeebeePay's hours grid pre-fills each fortnight — saves typing 80 for
        everyone, every payday. You override only when someone worked fewer hours.
      </p>

      <h3>6. Configure standing allowances and deductions</h3>
      <p>
        Standing items recur every payroll unless you remove them:
      </p>
      <ul>
        <li><strong>Allowances</strong> (added to gross, taxable): housing, vehicle, fuel, meals, school fees, leave fares, electricity, gas, phone, airfares.</li>
        <li><strong>Pre-tax deductions</strong>: salary sacrifice into super, voluntary Nasfund top-up.</li>
        <li><strong>Post-tax deductions</strong>: savings plan, education fund, Christmas savings, loan repayment.</li>
      </ul>
      <p>
        The pay stub shows each one as a line item so the employee can see exactly
        what's coming out and going where.
      </p>

      <h2>First fortnight</h2>

      <h3>7. Run the first pay period</h3>
      <p>
        On the new employee's first fortnight, the system computes:
      </p>
      <ol>
        <li>Base pay = (annual salary ÷ 26) or (hours × hourly rate)</li>
        <li>Plus allowances (taxable)</li>
        <li>Less salary sacrifice and voluntary Nasfund (pre-tax)</li>
        <li>Less 6% mandatory Nasfund (pre-tax)</li>
        <li>SWT calculated on the remainder using Tables A/B/C as appropriate, less dependant rebate</li>
        <li>Less standing post-tax deductions</li>
        <li>Less any cash advance you've entered for this period</li>
        <li>= Net pay, deposited to their bank accounts per their split percentages</li>
      </ol>

      <h3>8. Confirm the stub looks right</h3>
      <p>
        Always eyeball the first pay stub for a new employee before approving the run.
        Common things to catch: wrong residency status (drove tax 3× higher), missing
        bank account number (the BSP batch will reject the row), or a typo'd dependants
        count.
      </p>

      <h3>9. Make sure they get their stub</h3>
      <p>
        TeebeePay emails the stub the moment the payroll is approved. If they don't
        have an email address, the stub is also stored against the period in the
        archive — you can print and hand it over. We strongly recommend collecting
        email addresses for everyone, even if you have to set up a Gmail account
        with them on day one. It's free, it's instant, and it eliminates "I never got
        my pay slip" entirely.
      </p>

      <h2>Month-end and beyond</h2>

      <h3>10. NASFund return includes them automatically</h3>
      <p>
        From the first pay period onwards, the monthly Nasfund return that goes to
        the fund includes the new employee with their member number, date of birth,
        gross, and both contribution amounts. No extra paperwork.
      </p>

      <h3>11. SWT remittance to IRC</h3>
      <p>
        The tax withheld each fortnight is remitted to the IRC monthly. By the 7th of
        the following month, your total SWT for the month is summarised and paid via
        bank deposit referenced with your TIN. TeebeePay generates the summary PDF
        for you each month-end.
      </p>

      <h3>12. End-of-year reconciliation</h3>
      <p>
        By 14 January each year, every employee must receive a <strong>Statement of
        Earnings</strong> showing their full-year gross, tax withheld, and Nasfund
        contributions. By 14 February, all those statements plus a reconciliation
        return go to the IRC. TeebeePay produces both from the year's data — one
        click, signed by your AP, sent.
      </p>

      <h2>The shortcut</h2>
      <p>
        If steps 1 through 12 made you think "this is exactly the kind of thing I
        keep meaning to nail down but never actually do" — that's why TeebeePay
        exists. Bring us a CSV of your team and we'll have them all set up with
        member numbers verified, S1 forms on file, and a first sample fortnight
        ready for you to review before next payday. The first fortnight is free.
      </p>
    </BlogPost>
  );
}
