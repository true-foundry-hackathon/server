use dioxus::prelude::*;

#[component]
pub fn CoralDiamond() -> Element {
    rsx! {
        span {
            class: "coral-diamond-wrap",
            aria_hidden: "true",
            svg {
                class: "coral-diamond-svg",
                width: "12",
                height: "12",
                view_box: "0 0 10 10",
                fill: "none",
                rect {
                    x: "5",
                    y: "0.5",
                    width: "6",
                    height: "6",
                    rx: "1",
                    transform: "rotate(45 5 0.5)",
                    fill: "var(--color-coral-pulse, #ff6363)",
                }
            }
        }
    }
}

#[component]
pub fn GoogleIcon() -> Element {
    rsx! {
        svg {
            class: "icon-google",
            width: "18",
            height: "18",
            view_box: "0 0 24 24",
            path {
                d: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z",
                fill: "#4285F4",
            }
            path {
                d: "M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z",
                fill: "#34A853",
            }
            path {
                d: "M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z",
                fill: "#FBBC05",
            }
            path {
                d: "M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z",
                fill: "#EA4335",
            }
        }
    }
}

#[component]
pub fn PhoneIcon() -> Element {
    rsx! {
        svg {
            class: "icon-svg",
            width: "18",
            height: "18",
            view_box: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            stroke_width: "2.2",
            stroke_linecap: "round",
            stroke_linejoin: "round",
            path { d: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" }
        }
    }
}

#[component]
pub fn PhoneOffIcon() -> Element {
    rsx! {
        svg {
            class: "icon-svg",
            width: "18",
            height: "18",
            view_box: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            stroke_width: "2.2",
            stroke_linecap: "round",
            stroke_linejoin: "round",
            line { x1: "1", y1: "1", x2: "23", y2: "23" }
            path { d: "M9 9v.01" }
            path { d: "M10.6 10.6A16.03 16.03 0 0 0 14 14l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07" }
            path { d: "M4.11 2A2 2 0 0 0 2.13 4.18 19.79 19.79 0 0 0 5.2 12.81l1.5-1.5" }
        }
    }
}

#[component]
pub fn Kbd(children: Element) -> Element {
    rsx! {
        kbd {
            class: "kbd-cap",
            {children}
        }
    }
}
