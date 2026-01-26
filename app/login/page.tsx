"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
    const router = useRouter();

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="p-4">
                <Authenticator hideSignUp={true}>
                    {({ user }) => {
                        useEffect(() => {
                            if (user) {
                                router.push("/");
                            }
                        }, [user, router]);

                        return (
                            <div className="flex flex-col items-center justify-center space-y-4">
                                <p className="text-lg font-medium">Signing in...</p>
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            </div>
                        );
                    }}
                </Authenticator>
            </div>
        </div>
    );
}
