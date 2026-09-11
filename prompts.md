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
