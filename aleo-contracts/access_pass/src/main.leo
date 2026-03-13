import credits.aleo;

// Private access pass with optional expiry and single-use redemption via nullifier.
program access_pass_v1_xwnxp.aleo {
    @admin(address = "aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl")
    async constructor() {}

    mapping used_nullifiers: field => bool;

    record AccessPass {
        owner: address,
        creator_id: field,
        content_id: field,
        expiry: field,
        nullifier: field,
    }

    // Mint a private access pass after paying the creator.
    async transition buy_access(
        public creator_id: field,
        public content_id: field,
        public creator_address: address,
        public price: u64,
        public expiry: field,
        public nullifier: field,
    ) -> (AccessPass, Future) {
        assert(price > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            AccessPass {
                owner: self.signer,
                creator_id: creator_id,
                content_id: content_id,
                expiry: expiry,
                nullifier: nullifier,
            },
            finalize_buy_access(fut),
        );
    }

    async function finalize_buy_access(f: Future) {
        f.await();
    }

    // Prove the caller owns a valid access pass for this content at the given height.
    transition prove_access(
        pass: AccessPass,
        public creator_id: field,
        public content_id: field,
        public current_height: field,
    ) -> bool {
        assert_eq(pass.owner, self.signer);
        assert_eq(pass.creator_id, creator_id);
        assert_eq(pass.content_id, content_id);
        assert(pass.expiry > current_height);
        return true;
    }

    // Redeem once by revealing the nullifier. Future redemptions are blocked.
    async transition redeem_access(
        pass: AccessPass,
        public current_height: field,
        public nullifier: field,
    ) -> Future {
        assert_eq(pass.owner, self.signer);
        assert_eq(pass.nullifier, nullifier);
        assert(pass.expiry > current_height);
        return finalize_redeem(nullifier);
    }

    async function finalize_redeem(public nullifier: field) {
        let used: bool = used_nullifiers.get_or_use(nullifier, false);
        assert_eq(used, false);
        used_nullifiers.set(nullifier, true);
    }
}
