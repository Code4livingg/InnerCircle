import credits.aleo;

program tip_pay_v1_xwnxp.aleo {
    @admin(address = "aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl")
    async constructor() {}

    record TipReceipt {
        owner: address,
        creator_id: field,
        amount: u64,
    }

    // Anonymous tip from a private balance. The creator receives a private credits record.
    transition tip_private(
        public creator_id: field,
        public creator_address: address,
        public amount: u64,
        private payment: credits.aleo/credits,
    ) -> (credits.aleo/credits, credits.aleo/credits, TipReceipt) {
        assert(amount > 0u64);
        let (change, tip_record) = credits.aleo/transfer_private(payment, creator_address, amount);
        return (
            change,
            tip_record,
            TipReceipt {
                owner: self.signer,
                creator_id: creator_id,
                amount: amount,
            },
        );
    }

    transition prove_tip(
        receipt: TipReceipt,
        public creator_id: field,
        public amount: u64,
    ) -> bool {
        assert_eq(receipt.owner, self.signer);
        assert_eq(receipt.creator_id, creator_id);
        assert_eq(receipt.amount, amount);
        return true;
    }
}
