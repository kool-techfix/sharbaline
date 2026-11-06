import { redirect } from "next/navigation";

/** The portal has no public home page: everyone starts at sign-in. */
export default function HomePage() {
  redirect("/login");
}
