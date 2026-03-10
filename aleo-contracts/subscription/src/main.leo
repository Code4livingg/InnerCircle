import credits.aleo;

program sub_pay_v3_xwnxp.aleo {
    @admin(address = "aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl")
    async constructor() {}

    const SUBSCRIPTION_TERM_BLOCKS: field = 43200field;

    record Subscription {
        owner: address,
        creator_id: field,
        // Preserve the deployed record layout so this program remains upgradeable.
        expiry: field,
    }

    // Legacy path kept stable for upgrade compatibility with already-deployed state/signatures.
    async transition pay_and_subscribe(
        public creator_id: field,
        public creator_address: address,
        public price: u64,
    ) -> (Subscription, Future) {
        assert(price > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            Subscription {
                owner: self.signer,
                creator_id: creator_id,
                expiry: 0field,
            },
            finalize_pay_and_subscribe(fut),
        );
    }

    // Expiry-aware payment path. The caller supplies the intended expiry height as a field.
    async transition pay_and_subscribe_v2(
        public creator_id: field,
        public creator_address: address,
        public price: u64,
        public expiry: field,
    ) -> (Subscription, Future) {
        assert(price > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            Subscription {
                owner: self.signer,
                creator_id: creator_id,
                expiry: expiry,
            },
            finalize_pay_and_subscribe(fut),
        );
    }

    async function finalize_pay_and_subscribe(f: Future) {
        f.await();
    }

    transition prove_subscription(subscription: Subscription, public creator_id: field) -> bool {
        assert_eq(subscription.owner, self.signer);
        assert_eq(subscription.creator_id, creator_id);
        return true;
    }

    transition prove_subscription_v2(
        subscription: Subscription,
        public creator_id: field,
        public current_height: field,
    ) -> bool {
        assert_eq(subscription.owner, self.signer);
        assert_eq(subscription.creator_id, creator_id);

        let has_expiry: bool = subscription.expiry != 0field;
        assert(has_expiry);
        assert(subscription.expiry > current_height);
        return true;
    }
}
