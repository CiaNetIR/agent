import type { Metadata } from "next"
import { Vazirmatn } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { Providers } from "@/components/providers"

const vazir = Vazirmatn({
  variable: "--font-vazir",
  subsets: ["arabic", "latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "پنل پایش سرور | Server Monitor",
  description:
    "داشبورد زنده پایش وضعیت سرور — منابع، سرویس‌ها، پورت‌ها، پروسه‌ها و لاگ‌ها به‌صورت لحظه‌ای",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body
        className={`${vazir.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  )
}
