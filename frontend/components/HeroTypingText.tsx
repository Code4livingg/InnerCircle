"use client";

import { useEffect, useState, useCallback, useRef } from "react";

const PHRASES = [
    "Where Privacy Meets Power.",
    "Your Circle. Your Rules.",
    "Subscribe Anonymously.",
    "Zero Knowledge. Full Access.",
];

const TYPE_SPEED = 60;
const DELETE_SPEED = 35;
const PAUSE_AFTER_TYPE = 2200;
const PAUSE_AFTER_DELETE = 400;

export function HeroTypingText() {
    const [displayed, setDisplayed] = useState("");
    const phraseIndex = useRef(0);
    const charIndex = useRef(0);
    const isDeleting = useRef(false);

    const tick = useCallback(() => {
        const current = PHRASES[phraseIndex.current];

        if (!isDeleting.current) {
            // Typing
            charIndex.current += 1;
            setDisplayed(current.slice(0, charIndex.current));

            if (charIndex.current === current.length) {
                isDeleting.current = true;
                return PAUSE_AFTER_TYPE;
            }
            return TYPE_SPEED + Math.random() * 40;
        }

        // Deleting
        charIndex.current -= 1;
        setDisplayed(current.slice(0, charIndex.current));

        if (charIndex.current === 0) {
            isDeleting.current = false;
            phraseIndex.current = (phraseIndex.current + 1) % PHRASES.length;
            return PAUSE_AFTER_DELETE;
        }
        return DELETE_SPEED;
    }, []);

    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout>;

        const loop = () => {
            const delay = tick();
            timeout = setTimeout(loop, delay);
        };

        timeout = setTimeout(loop, 600);
        return () => clearTimeout(timeout);
    }, [tick]);

    return (
        <div className="ic-hero__typing">
            <span className="ic-hero__typing-text">{displayed}</span>
        </div>
    );
}
