# Prompts

Every prompt given to an LLM (Claude Opus 5, via Claude Code) while building this
application, in order, recorded as the work happened.

---

## 1. Assignment, stack, and how to work

> OTP Based User Login
>
> **Goals**
>
> 1. Build a web application with two flows
>    - **Registration Flow**
>      - Collect the user's email address, first name, and last name, and register them.
>      - On successful registration, generate a random 6-digit numeric code and display it to the user. They will need this code to log in later.
>    - **User Recognition & Login Flow**
>      - The form is a checkout form that collects email address, phone number, and shipping address.
>      - As the user types, validate in real time whether a complete, well-formed email address has been entered. Once it has, run a recognition check in the background while the user continues filling out the rest of the form.
>      - If the email matches a registered user, show a modal prompting them for their numeric code. Provide option for user to skip the login step and get back to the checkout form.
>      - Validate the submitted code against the one issued at registration. On a match, log the user in and close the modal, revealing the checkout form. On a mismatch, show an error inside the modal.
>      - Once logged in, display the user's name at the top of the checkout form. The user can continue filling it out.
>      - Submitting the form should simply record the form data in a database table – no real payment processing needed.
> 2. Deploy the application to the public internet so the team can access it.
>
> **Expected Artifacts**
>
> 1. A publicly hosted website the team can try out.
> 2. A GitHub repository containing the full source code, with the boltapp-hiring GitHub user granted access. The database schema must be checked in as .sql files.
> 3. A prompts.md in the same repository listing every prompt you gave to an LLM while building the application.
>
> **Additional Instructions**
>
> 1. You have 2 days to complete this assignment.
> 2. The application must have distinct frontend, API, and database layers.
> 3. Recommended stack: TypeScript, React, Go, and Postgres – but feel free to use whatever you're comfortable with.
> 4. Free-tier hosting services such as Vercel and Supabase are fine
>
> A.) This is the assignment they have given me.
>
> B.) They have suggested they stack to use as TypeScript, React, Go, and
> Postgres, but I don't the know the Go yet. So I will be using NodeJs instead
> because it is better to code in which you are comfortable with.
>
> C.) I want three top-level directories for frontend, backend and database
> because that is a core requirement of the task.
>
> D.) Do not try to finish the assignment for me. We are going to build it
> incrementally, and I want to understand each part before moving on. Also,
> before making significant implementation decisions, explain what you're
> proposing and why.

## 2. Database schema

> Now let's create the schema. So from the assigmenment we can see that firstly
> there is user information like first name, last name, email, and code. The
> other enitity is the checkout form, where there is information about email,
> phone number and shipping address..
>
> So at minimum we are looking at 2 entities: users and checkouts. We can add
> add others as per our need but this are essential.

## 3. Clarifying how login state persists

> Can you explain the part 1.

(Asked in response to an outline of the open schema questions, where part 1 was
"where does login state live after the code is verified?". No code was written
in response — the answer covered HTTP being stateless, self-contained tokens
versus session references, and cookie versus localStorage storage, so that the
choice below could be made deliberately rather than by default.)

## 4. Sessions table

> Yeah, we will go with the sessions rows and httpOnly cookies. Therefore add
> the sessions table.

## 5. Checking the guest checkout case against the schema

> Hey, what about the guest case? We have been mentioned in the assignment that
> a person should be able to checkout the order without having registered. How
> does that affect out schema?

## 6. Session lifetime and persistence policy

> Hey, what about the login persists after the code is verified?

(The mechanism had already been settled — session rows plus an httpOnly cookie,
with the table added in 002. This covered the remaining policy questions: the
end-to-end lifecycle including restoring a session on page load via an
/api/auth/me call, how long a session should last, absolute versus sliding
expiry, and cleanup of expired rows. No schema change was needed, since
expires_at already supports any of these.)

## 7. Rate limiting the login code

> Hey one thing crossed my mind that the assignment has given a code of just
> digits which means 1 million permutations. It can be easily bruteforced if a
> user keep sending verification requests. We need to implent some limiting
> operations on it. How can we do that?

(Covered where to hold the counter — in-memory versus Redis versus a Postgres
table — what to key it on, and why a sliding window beats a fixed one. No code
written yet; the table was proposed and left pending approval.)

> go ahead and add the login_attempts table

## 8. Email case sensitivity, constraints and indexes

> 1.) Hey, I had a small doubt about the the email matching, If I type
> Kunal@gmail.com, and kunal@gmail.com, it should be treated same.
>
> 2.) Also explain me the constraints and indexes.

(Explanatory. Confirmed the case-insensitive behaviour against a live database
and walked through every constraint and index in the schema. No code changed.)

## 9. Database connection and pool sizing

> Now let's move to the API foundation.
> Firstly we need to create and connect with our database.
> And we need a pool of connections instead a single connection because user can
> send the requests at the same time. Now we are not building some large
> applications therefore we will keep the number of connections low.
> What do you suggest, how many should we keep?

## 10. Migration runner

> Now let's add the migration runner.

## 11. SQL injection protection

> SQL injection protection
>
> * Establish a database-querying pattern where user-provided values are passed
>   as parameters rather than interpolated into SQL strings.
> * Structure the database access code so parameterized queries are the
>   normal/default approach for future endpoints.

## 12. Consistent error shape

> now one thing we should we add is the error shapes there should be some
> structure to them. Because if there is not structure, each error might take
> different shape.

## 13. Registration endpoint: code generation and duplicate handling

> A. One of the most important parts is how the code generated. I suggest that
> Generate the 6-digit login code using a cryptographically secure
> random-number generator available in Node.js, rather than Math.random(), but
> you can suggest me the better alternatives.
>
> B. The other thing is about the duplicate regsitrations, consider both the
> normal condition and as well as the concurrent condtion. Do not rely only on
> an application-level "check then insert" because two concurrent requests could
> both observe that the email does not exist.
> Use the database's uniqueness constraint as the final guarantee that duplicate
> emails cannot be stored.

## 14. Recognition endpoint: what to reveal, and GET vs POST

> What are the other options that we can reveal. For second I honestly don't
> know, you first tell me both's pros and then I will decide.

(Explanatory, ahead of building the endpoint. Covered what a recognition
response could include beyond a yes/no and the privacy cost of each, and the
trade-offs between GET and POST for a read-only endpoint that takes an email
address. No code written.)

> Let's go with the bare boolean and POST

## 15. Frontend

> Now let's move to the frontend.

## 16. Recognition flow: firing rate, races, and failure handling

> > How often the check fires. Typing an email is ~18 keystrokes. Firing per
> > keystroke is 18 requests for one answer.
> > What happens when an earlier, slower request answers after a later one.
> > Responses don't arrive in the order you sent them - this is a genuine bug
> > source, not a hypothetical.
> > What happens when the recognition call fails outright. The user is
> > mid-checkout; what should they see?
>
> What do you suggest for this?

(Explanatory, ahead of building the checkout page. Covered debounce versus
throttle and why 400ms, gating on a regex so the request only fires for a
plausibly complete address, AbortController in useEffect cleanup as the fix for
out-of-order responses, why a failed recognition should be silent, and why a
dismissed modal must be remembered separately from an already-checked address.
No code written.)

> go ahead with all of it

## 17. Registration page

> Now let's do the registration page
