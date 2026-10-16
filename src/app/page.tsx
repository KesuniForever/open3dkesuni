import LandingPage, { landingMetadata } from "./welcome/LandingPage";

// Everyone's first page is the landing page; the operator overview lives at /dashboard.
export const dynamic = "force-dynamic";
export const generateMetadata = landingMetadata;
export default LandingPage;
