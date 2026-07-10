import facebookIcon from "@/components/assets/icons/facebook.png";
import instagramIcon from "@/components/assets/icons/instagram.png";
import linkedinIcon from "@/components/assets/icons/linkedin.png";
import pinterestIcon from "@/components/assets/icons/pinterest.png";
import redditIcon from "@/components/assets/icons/reddit.png";
import tiktokIcon from "@/components/assets/icons/tik-tok.png";
import twitterIcon from "@/components/assets/icons/twitter.png";
import type { SocialPlatformId } from "@/lib/agency/mock";

export type SocialPlatformOption = {
  id: SocialPlatformId;
  label: string;
  icon: { src: string };
};

export const SOCIAL_PLATFORM_OPTIONS: SocialPlatformOption[] = [
  { id: "facebook", label: "Facebook", icon: facebookIcon },
  { id: "instagram", label: "Instagram", icon: instagramIcon },
  { id: "linkedin", label: "LinkedIn", icon: linkedinIcon },
  { id: "pinterest", label: "Pinterest", icon: pinterestIcon },
  { id: "reddit", label: "Reddit", icon: redditIcon },
  { id: "tiktok", label: "TikTok", icon: tiktokIcon },
  { id: "twitter", label: "Twitter / X", icon: twitterIcon }
];

export function getSocialPlatform(platformId: SocialPlatformId) {
  return SOCIAL_PLATFORM_OPTIONS.find((item) => item.id === platformId);
}
